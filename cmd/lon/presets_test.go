package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildPresets(t *testing.T) {
	root := t.TempDir()
	write := func(s string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, presetsFile), []byte(s), 0644); err != nil {
			t.Fatal(err)
		}
	}
	base := config{Project: project{Target: "App", BuildDir: "build"}}
	debug, err := applyBuildPreset(root, base, "")
	if err != nil {
		t.Fatal(err)
	}
	release, err := applyBuildPreset(root, base, "release")
	if err != nil {
		t.Fatal(err)
	}
	if debug.Preset != "debug" || !*debug.Build.Debug || *release.Build.Debug || release.Build.Optimization != "-O2" || debug.Project.BuildDir == release.Project.BuildDir {
		t.Fatalf("incorrect builtins: %+v %+v", debug, release)
	}
	write(`{"default_preset":"logging","presets":{"logging":{"extends":"release","debug":true,"build_flags":["-DLOG=1"]}}}`)
	custom, err := applyBuildPreset(root, base, "")
	if err != nil {
		t.Fatal(err)
	}
	if custom.Preset != "logging" || !*custom.Build.Debug || custom.Build.Optimization != "-O2" {
		t.Fatalf("inheritance: %+v", custom)
	}
	if err := os.MkdirAll(filepath.Join(root, stateDir), 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(root, stateDir, "build-preset.json"), "release"); err != nil {
		t.Fatal(err)
	}
	selected, err := applyBuildPreset(root, base, "")
	if err != nil || selected.Preset != "release" {
		t.Fatalf("selection: %+v %v", selected, err)
	}
	explicit, err := applyBuildPreset(root, base, "debug")
	if err != nil || explicit.Preset != "debug" {
		t.Fatal("explicit override ignored", err)
	}
	write(`{"presets":{"logging":{"extends":"release","debug":true,"build_flags":["-DLOG=2"]}}}`)
	changed, err := applyBuildPreset(root, base, "logging")
	if err != nil {
		t.Fatal(err)
	}
	if changed.Project.BuildDir == custom.Project.BuildDir {
		t.Fatal("changed flags reuse stale objects")
	}
	for _, invalid := range []string{
		`{"presets":{"x":{"extends":"missing"}}}`,
		`{"presets":{"x":{"extends":"y"},"y":{"extends":"x"}}}`,
		`{"presets":{"../x":{}}}`,
		`{"presets":{"x":{"optimization":"-Oinvalid"}}}`,
		`{"default_preset":"missing"}`,
		`{"presets":{"x":{"build_flags":["-Dx\nall:"]}}}`,
	} {
		write(invalid)
		if _, err := readPresets(root); err == nil {
			t.Fatalf("accepted %s", invalid)
		}
	}
}

func TestPresetMakeAndCompilationDatabase(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("make unavailable")
	}
	root := t.TempDir()
	makefile := `BUILD_DIR = build
DEBUG = 1
OPT = -Og
CFLAGS = $(OPT) -DGENERATED=1
ifeq ($(DEBUG),1)
CFLAGS += -g
endif
all: CFLAGS += -DPER_FILE=1
all:
	$(CC) $(CFLAGS) -c main.c -o $(BUILD_DIR)/main.o
	@echo $(LDFLAGS)
`
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(makefile), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, presetsFile), []byte(`{"presets":{"test":{"extends":"release","build_flags":["-DAPP=42","-I\"include dir\""],"c_flags":["-Wall"],"link_flags":["-Wl,--gc-sections"]}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	cfg, err := applyBuildPreset(root, config{Project: project{BuildDir: "build"}, Tools: map[string]string{"make": makePath, "gcc": "/toolchain/arm-none-eabi-gcc"}}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if err := generateCompilationDatabase(root, cfg); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, stateDir, "compile_commands.json"))
	if err != nil {
		t.Fatal(err)
	}
	var commands []compileCommand
	if err := json.Unmarshal(data, &commands); err != nil {
		t.Fatal(err)
	}
	args := strings.Join(commands[0].Arguments, "\n")
	for _, flag := range []string{"-O2", "-DGENERATED=1", "-DPER_FILE=1", "-DAPP=42", "-Iinclude dir", "-Wall", cfg.Project.BuildDir + "/main.o"} {
		if !strings.Contains(args, flag) {
			t.Fatalf("missing %s in %s", flag, args)
		}
	}
	if strings.Contains(args, "\n-g\n") {
		t.Fatal("release includes debug symbols")
	}
	err = build(root, cfg, func(root string, command, env []string) error {
		command = append(command[:1], append([]string{"-n"}, command[1:]...)...)
		cmd := exec.Command(command[0], command[1:]...)
		cmd.Dir = root
		cmd.Env = env
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v", output, err)
		}
		if !strings.Contains(string(output), "-Wl,--gc-sections") || !strings.Contains(string(output), "-DGENERATED=1") {
			t.Fatalf("flags lost: %s", output)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	fragments, _ := filepath.Glob(filepath.Join(root, stateDir, ".preset-*.mk"))
	if len(fragments) != 0 {
		t.Fatal("temporary Makefiles leaked")
	}
}

func TestPresetCleanRetainsOtherConfigurations(t *testing.T) {
	root := t.TempDir()
	base := config{Project: project{BuildDir: "build"}}
	debug, err := applyBuildPreset(root, base, "debug")
	if err != nil {
		t.Fatal(err)
	}
	release, err := applyBuildPreset(root, base, "release")
	if err != nil {
		t.Fatal(err)
	}
	for _, cfg := range []config{debug, release} {
		if err := os.MkdirAll(filepath.Join(root, cfg.Project.BuildDir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := perform(root, "clean", release, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, release.Project.BuildDir)); !os.IsNotExist(err) {
		t.Fatal("release not cleaned")
	}
	if _, err := os.Stat(filepath.Join(root, debug.Project.BuildDir)); err != nil {
		t.Fatal("clean removed another preset", err)
	}
}

func TestPresetSelectionRecovery(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, stateDir), 0755); err != nil {
		t.Fatal(err)
	}
	selected := filepath.Join(root, stateDir, "build-preset.json")
	if err := writeJSON(selected, "removed"); err != nil {
		t.Fatal(err)
	}
	if _, err := applyBuildPreset(root, config{Project: project{BuildDir: "build"}}, ""); err == nil {
		t.Fatal("missing selected preset silently fell back")
	}
	if err := presetsCommand(root, "presets", ""); err != nil {
		t.Fatal("cannot open selector for missing preset", err)
	}
	if err := presetsCommand(root, "select-preset", "release"); err != nil {
		t.Fatal(err)
	}
	if err := presetsCommand(root, "select-preset", "unknown"); err == nil {
		t.Fatal("selected unknown preset")
	}
	data, err := os.ReadFile(selected)
	if err != nil {
		t.Fatal(err)
	}
	var name string
	if err := json.Unmarshal(data, &name); err != nil || name != "release" {
		t.Fatal("lost recovered selection", string(data), err)
	}
}

func TestPresetBuildCreatesNestedOutputAfterClean(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("make unavailable")
	}
	root := t.TempDir()
	// Some CubeMX versions emit plain mkdir, which cannot create parents.
	makefile := "BUILD_DIR = build\nall: $(BUILD_DIR)/App.elf\n$(BUILD_DIR)/App.elf: | $(BUILD_DIR)\n\techo firmware > $@\n$(BUILD_DIR):\n\tmkdir $@\n"
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte(makefile), 0644); err != nil {
		t.Fatal(err)
	}
	cfg, err := applyBuildPreset(root, config{Project: project{Target: "App", BuildDir: "build"}, Tools: map[string]string{"make": makePath, "gcc": "arm-none-eabi-gcc"}}, "debug")
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
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
	data, err := os.ReadFile(filepath.Join(root, "Makefile"))
	if err != nil || string(data) != makefile {
		t.Fatal("generated Makefile changed", err)
	}
}
