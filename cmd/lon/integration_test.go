package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRenameMigratesLegacyConfiguration(t *testing.T) {
	for _, dir := range []string{legacyStateDir, previousStateDir} {
		t.Run(dir, func(t *testing.T) { testRenameMigratesLegacyConfiguration(t, dir) })
	}
}

func testRenameMigratesLegacyConfiguration(t *testing.T, legacyDir string) {
	root := fixture(t)
	plugins, makePath := fakeTools(t)
	tools := discoverTools(options{ide: plugins, make: makePath}, nil).Tools
	legacy := filepath.Join(root, legacyDir)
	if err := os.Mkdir(legacy, 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(legacy, "tools.json"), config{Tools: tools}); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(legacy, "target.json"), probe{Serial: "AAAAAAAA"}); err != nil {
		t.Fatal(err)
	}
	if savedTools(root)["gcc"] != tools["gcc"] {
		t.Fatal("legacy tool paths were not reused")
	}
	selected, err := readSelectedProbe(root)
	if err != nil || selected == nil || selected.Serial != "AAAAAAAA" {
		t.Fatalf("legacy board selection lost: %v, %v", selected, err)
	}
	if err := saveSelectedProbe(root, probe{Serial: "BBBBBBBB"}); err != nil {
		t.Fatal(err)
	}
	selected, err = readSelectedProbe(root)
	if err != nil || selected == nil || selected.Serial != "BBBBBBBB" {
		t.Fatal("new board selection must override legacy selection")
	}
	editor := filepath.Join(root, ".vscode")
	if err := os.Mkdir(editor, 0755); err != nil {
		t.Fatal(err)
	}
	for name, document := range map[string]map[string]any{
		"settings.json":         {"codeready.cubeMXPath": "/custom/CubeMX", "codeready.documentationPaths": []string{"manuals"}, "codeready.makePath": "/old/make", "lon.makePath": "/new/make", "lon.focusUserCodeOnOpen": true, "dauhuniec.makePath": "/current/make", "editor.fontSize": 17},
		"tasks.json":            {"tasks": []any{map[string]any{"label": "CodeReady: Build", "command": "${config:codeready.runner}"}, map[string]any{"label": "Lon-daŭhuniec: Build", "command": "${config:lon.runner}"}, map[string]any{"label": "My build", "command": "custom-build"}}},
		"launch.json":           {"configurations": []any{map[string]any{"name": "CodeReady: Debug", "executable": "${config:codeready.elf}"}, map[string]any{"name": "Lon-daŭhuniec: Debug", "executable": "${config:lon.elf}"}}},
		"c_cpp_properties.json": {"configurations": []any{map[string]any{"name": "CodeReady", "compilerPath": "${config:codeready.gcc}"}, map[string]any{"name": "Lon-daŭhuniec", "compilerPath": "${config:lon.gcc}"}}},
	} {
		if err := writeJSON(filepath.Join(editor, name), document); err != nil {
			t.Fatal(err)
		}
	}
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	for pass := 0; pass < 2; pass++ {
		if err := configureVSCode(root, plugins, config{Project: p, Tools: tools}); err != nil {
			t.Fatal(err)
		}
	}
	settings, err := readObject(filepath.Join(editor, "settings.json"))
	if err != nil || settings["dauhuniec.cubeMXPath"] != "/custom/CubeMX" || settings["dauhuniec.makePath"] != "/current/make" || settings["dauhuniec.focusUserCodeOnOpen"] != true || settings["editor.fontSize"] != float64(17) {
		t.Fatalf("settings migration failed: %v, %v", settings, err)
	}
	for _, name := range []string{"settings.json", "tasks.json", "launch.json", "c_cpp_properties.json"} {
		data, err := os.ReadFile(filepath.Join(editor, name))
		if err != nil || !json.Valid(data) || strings.Contains(string(data), `"codeready.`) || strings.Contains(string(data), "config:codeready.") || strings.Contains(string(data), "CodeReady") || strings.Contains(string(data), `"lon.`) || strings.Contains(string(data), "config:lon.") || strings.Contains(string(data), "Lon-daŭhuniec") {
			t.Fatalf("legacy editor configuration remains in %s: %s (%v)", name, data, err)
		}
	}
	tasks, err := readObject(filepath.Join(editor, "tasks.json"))
	if err != nil || len(tasks["tasks"].([]any)) != 6 {
		t.Fatalf("user task lost or managed tasks duplicated: %v, %v", tasks, err)
	}
}

func fakeTools(t *testing.T) (string, string) {
	t.Helper()
	plugins := filepath.Join(t.TempDir(), "plugins")
	for family, names := range map[string][]string{
		"gnu-tools-for-stm32.14.3": {"arm-none-eabi-gcc", "arm-none-eabi-gdb", "arm-none-eabi-objcopy", "arm-none-eabi-objdump", "arm-none-eabi-size", "arm-none-eabi-nm"},
		"stlink-gdb-server.2.2":    {"ST-LINK_gdbserver"},
		"cubeprogrammer.2.22":      {"STM32_Programmer_CLI"},
		"make.win32_2.2.0":         {"make"},
	} {
		dir := filepath.Join(plugins, "com.st.stm32cube.ide.mcu.externaltools."+family, "tools/bin")
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			if err := os.WriteFile(filepath.Join(dir, name+exeSuffix()), []byte("tool fixture"), 0755); err != nil {
				t.Fatal(err)
			}
		}
	}
	makePath := filepath.Join(t.TempDir(), "make"+exeSuffix())
	if err := os.WriteFile(makePath, []byte("make fixture"), 0755); err != nil {
		t.Fatal(err)
	}
	return plugins, makePath
}

func TestInspectIsReadOnlyAndFindsCustomToolPaths(t *testing.T) {
	root := fixture(t)
	plugins, makePath := fakeTools(t)
	r := inspect(root, options{ide: plugins, make: makePath}, false)
	if r.Project == nil || r.Ready || r.Configured || r.SchemaVersion != 1 || checkErrors(r.Checks) != "" {
		t.Fatalf("wrong diagnostic: %+v", r)
	}
	if len(r.Tools) < 9 {
		t.Fatalf("tools missing: %+v", r.Tools)
	}
	for _, path := range []string{".vscode", stateDir} {
		if _, err := os.Stat(filepath.Join(root, path)); !os.IsNotExist(err) {
			t.Fatalf("inspect wrote %s", path)
		}
	}
}

func TestCubeMXDeviceAndCompilerSettingsAreNotBoardSpecific(t *testing.T) {
	root := fixture(t)
	if err := os.WriteFile(filepath.Join(root, "Lab.ioc"), []byte("Mcu.CPN=STM32F446RETx\nProjectManager.TargetToolchain=Makefile\n"), 0644); err != nil {
		t.Fatal(err)
	}
	data := "TARGET = Lab\nBUILD_DIR = build\nHAL_DIR = Drivers/HAL\nCPU = -mcpu=cortex-m4\nFPU = -mfpu=fpv4-sp-d16\nC_DEFS = -DUSE_HAL_DRIVER -DSTM32F446xx\nC_INCLUDES = -ICore/Inc -I$(HAL_DIR)/Inc\nMCU = $(CPU) -mthumb $(FPU) -mfloat-abi=hard\n"
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
	p, err := readProject(root)
	if err != nil || p.Device != "STM32F446RETX" {
		t.Fatalf("%+v: %v", p, err)
	}
	configuration := compilerConfiguration(root, map[string]any{})
	if defines := configuration["defines"].([]string); len(defines) != 2 || defines[1] != "STM32F446xx" {
		t.Fatalf("wrong defines: %v", defines)
	}
	if includes := configuration["includePath"].([]string); len(includes) != 2 || includes[1] != "${workspaceFolder}/Drivers/HAL/Inc" {
		t.Fatalf("wrong includes: %v", includes)
	}
	if args := configuration["compilerArgs"].([]string); len(args) != 4 {
		t.Fatalf("wrong CPU flags: %v", args)
	}
}

func TestMergePreservesUserTasksSettingsAndCommentsInBackup(t *testing.T) {
	root := fixture(t)
	for _, dir := range []string{stateDir, ".vscode"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	originalTasks := []byte(`{
  // User build stays the default.
  "version": "2.0.0",
  "tasks": [{"label":"My build","command":"echo","group":{"kind":"build","isDefault":true},}],
}`)
	for name, data := range map[string][]byte{
		"tasks.json":      originalTasks,
		"settings.json":   []byte(`{"editor.fontSize":17,"link":"https://example.org/a//b", "dauhuniec.shell":"old/sh.exe", "dauhuniec.make":"old/make.exe", "dauhuniec.makePath":"old/make.exe", /* comment */}`),
		"extensions.json": []byte(`{"recommendations":["my.extension",],}`),
	} {
		if err := os.WriteFile(filepath.Join(root, ".vscode", name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{Project: p, Tools: map[string]string{"programmer": "programmer"}}
	for i := 0; i < 2; i++ {
		if err := configureVSCode(root, "no-plugins", cfg); err != nil {
			t.Fatal(err)
		}
	}
	settings, err := readObject(filepath.Join(root, ".vscode/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := settings["dauhuniec.shell"]; exists {
		t.Fatal("legacy shell setting was retained")
	}
	if _, exists := settings["dauhuniec.makePath"]; exists {
		t.Fatal("legacy Make override was retained")
	}
	if settings["editor.fontSize"] != float64(17) || settings["link"] != "https://example.org/a//b" {
		t.Fatalf("user settings lost: %v", settings)
	}
	tasks, err := readObject(filepath.Join(root, ".vscode/tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	entries := tasks["tasks"].([]any)
	if len(entries) != 6 || entries[0].(map[string]any)["label"] != "My build" {
		t.Fatalf("tasks duplicated or lost: %+v", entries)
	}
	for _, entry := range entries[1:] {
		if group, ok := entry.(map[string]any)["group"].(map[string]any); ok && group["isDefault"] == true {
			t.Fatal("user default task overridden")
		}
	}
	backups, _ := filepath.Glob(filepath.Join(root, stateDir, "backups/*/tasks.json"))
	foundOriginal := false
	for _, backup := range backups {
		bytes, _ := os.ReadFile(backup)
		if string(bytes) == string(originalTasks) {
			foundOriginal = true
		}
	}
	if !foundOriginal {
		t.Fatal("original JSONC not preserved in backup")
	}
}

func TestInvalidEditorSettingsAreLeftUntouched(t *testing.T) {
	root := fixture(t)
	for _, dir := range []string{stateDir, ".vscode"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	file := filepath.Join(root, ".vscode/settings.json")
	original := []byte(`{"invalid": }`)
	if err := os.WriteFile(file, original, 0644); err != nil {
		t.Fatal(err)
	}
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := configureVSCode(root, "", config{Project: p}); err == nil {
		t.Fatal("invalid settings accepted")
	}
	actual, _ := os.ReadFile(file)
	if string(actual) != string(original) {
		t.Fatal("invalid settings changed")
	}
	if _, err := os.Stat(filepath.Join(root, ".vscode/tasks.json")); !os.IsNotExist(err) {
		t.Fatal("partial configuration written")
	}
}

func TestWindowsDiscoversCubeIDEMakeWithoutShell(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows tool discovery")
	}
	plugins, oldMake := fakeTools(t)
	d := discoverTools(options{ide: plugins}, map[string]string{"make": oldMake, "shell": "missing-sh.exe"})
	if checkErrors(d.Checks) != "" || !strings.HasPrefix(d.Tools["make"], plugins) || d.Tools["shell"] != "" {
		t.Fatalf("expected native CubeIDE Make without shell: %+v", d)
	}
	migrated := discoverTools(options{ide: plugins, make: oldMake}, map[string]string{"make": oldMake, "shell": "missing-sh.exe"})
	if migrated.Tools["make"] != d.Tools["make"] {
		t.Fatalf("saved MSYS override was not migrated: %+v", migrated)
	}
	explicit := discoverTools(options{ide: plugins, make: oldMake}, nil)
	if explicit.Tools["make"] != oldMake {
		t.Fatalf("explicit Make override lost: %+v", explicit)
	}
}

func TestWindowsNativeMakeBuildCleanRebuild(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("requires native Windows Make")
	}
	makePath, err := exec.LookPath("make.exe")
	if err != nil {
		t.Fatal("native make.exe required for Windows integration test")
	}
	root := filepath.Join(t.TempDir(), "project with spaces")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	// Keep CubeMX's Unix mkdir recipe: it must never execute. The echo recipe
	// requires cmd.exe even if a Unix shell is inherited from the user's environment.
	contents := "TARGET = Lab\nBUILD_DIR = artifacts/build\nall: $(BUILD_DIR)/Lab.elf\n$(BUILD_DIR)/Lab.elf: | $(BUILD_DIR)\n\techo firmware> $@\n$(BUILD_DIR):\n\tmkdir -p $@\n"
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(contents), 0644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAKESHELL", "missing-sh.exe")
	t.Setenv("SHELL", "missing-sh.exe")
	cfg := config{Project: project{Target: "Lab", BuildDir: "artifacts/build"}, Tools: map[string]string{"make": makePath, "gcc": "arm-none-eabi-gcc.exe"}}
	for i := 0; i < 2; i++ {
		if err := build(root, cfg, run); err != nil {
			t.Fatal(err)
		}
		if !regularFile(elfPath(root, cfg.Project)) {
			t.Fatal("firmware output missing")
		}
		if err := perform(root, "clean", cfg, run); err != nil {
			t.Fatal(err)
		}
	}
	original, _ := os.ReadFile(filepath.Join(root, "Makefile"))
	if string(original) != contents {
		t.Fatal("generated Makefile was modified")
	}
}
