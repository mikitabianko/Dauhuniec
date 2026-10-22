package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func hostFixture(t *testing.T, goos string) toolHost {
	t.Helper()
	root, err := canonical(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return toolHost{OS: goos, Arch: "arm64", Home: root, Env: map[string]string{}, Roots: []string{root}}
}
func toolFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\ncase \" $* \" in *\" -n \"*) echo \"dauhuniec-cc -DTEST_PROJECT -c main.c -o build/main.o\"; exit 0;; esac\ncase \"$LANG\" in\n de_*) echo 'Werkzeug Ausgabe 14';;\n ru_*) echo 'Версия инструмента 14';;\n *) echo 'Tool version 14';;\nesac\n"), 0755); err != nil {
		t.Fatal(err)
	}
}
func ideFixture(t *testing.T, h toolHost, name string, missing ...string) string {
	t.Helper()
	root := filepath.Join(h.Roots[0], name)
	plugins := filepath.Join(root, "plugins")
	if h.OS == "darwin" {
		plugins = filepath.Join(root, "Contents/Eclipse/plugins")
	}
	for _, c := range ideComponents {
		skip := false
		for _, k := range missing {
			if k == c.key {
				skip = true
			}
		}
		if !skip {
			toolFile(t, filepath.Join(plugins, "com.st.stm32cube.ide.mcu.externaltools."+c.family+".14.3", "tools/bin", c.binary+h.suffix()))
		}
	}
	return root
}
func TestDiscoveryLiteralPathsLocalesAndOriginalScenario(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("macOS layout and POSIX locale executable fixture; covered by macOS and Linux runners")
	}
	h := hostFixture(t, "darwin")
	h.Roots = []string{filepath.Join(h.Home, "Applications")}
	root := ideFixture(t, h, "STMicroelectronics/STM32CubeIDE_1.19.0 ü [test] Кириллица.app")
	var baseline map[string]map[string]string
	for _, locale := range []string{"de_DE.UTF-8", "en_US.UTF-8", "ru_RU.UTF-8"} {
		h.Env["LANG"] = locale
		h.Env["LC_ALL"] = locale
		r := discoverShared(h, options{}, nil, true)
		server := r.Actions["debug"]["server"]
		if !filepath.IsAbs(server) || !regularFile(server) {
			t.Fatalf("original empty-server scenario failed: %+v", r)
		}
		if baseline != nil && !reflect.DeepEqual(baseline, r.Actions) {
			t.Fatal("locale affected discovery")
		}
		baseline = r.Actions
		explicit := discoverShared(h, options{ide: root}, nil, true)
		if !reflect.DeepEqual(explicit.Actions, r.Actions) {
			t.Fatal("literal explicit path differs")
		}
		if runtime.GOOS != "windows" {
			cmd := exec.Command(server, "--version")
			cmd.Env = append(os.Environ(), "LANG="+locale, "LC_ALL="+locale)
			if data, err := cmd.Output(); err != nil || !strings.Contains(string(data), map[string]string{"de_DE.UTF-8": "Werkzeug", "en_US.UTF-8": "Tool version", "ru_RU.UTF-8": "Версия"}[locale]) {
				t.Fatalf("localized executable: %s %v", data, err)
			}
			t.Setenv("LANG", locale)
			t.Setenv("LC_ALL", locale)
			checked := inspect(fixture(t), options{ide: root}, true)
			for _, c := range checked.Checks {
				if strings.HasSuffix(c.ID, ".launch") && c.Status != "ok" {
					t.Fatalf("localized doctor validation failed: %+v", c)
				}
			}
		}
	}
}
func TestSuitableSelectionVersionFallbackAndConsistency(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	old := ideFixture(t, h, "STM32CubeIDE_1.9.0")
	newest := ideFixture(t, h, "STM32CubeIDE_1.100.0", "gdb", "server")
	complete := ideFixture(t, h, "STM32CubeIDE_1.20.0")
	r := discoverShared(h, options{}, nil, true)
	if !strings.HasPrefix(r.Actions["debug"]["server"], complete) || !strings.HasPrefix(r.Actions["build"]["gcc"], newest) {
		t.Fatalf("wrong numeric/action selection: %+v", r.Actions)
	}
	for _, action := range []string{"build", "debug", "flash", "setup"} {
		for key, p := range r.Actions[action] {
			if key == "make" {
				continue
			}
			if action == "build" && !strings.HasPrefix(p, newest) {
				t.Fatal("mixed build installation")
			}
			if action == "debug" && !strings.HasPrefix(p, complete) {
				t.Fatal("mixed debug installation")
			}
		}
	}
	previous := map[string]string{"gcc": discoverShared(h, options{ide: old}, nil, false).Tools["gcc"]}
	r = discoverShared(h, options{}, previous, true)
	if !strings.HasPrefix(r.Actions["debug"]["server"], old) {
		t.Fatal("last working toolset not preferred")
	}
}
func TestExplicitInvalidPathRetainsAlternativesAndDoesNotReplace(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	ideFixture(t, h, "STM32CubeIDE-1.18.app")
	for _, opts := range []options{{ide: filepath.Join(h.Home, "missing [path]")}, {make: filepath.Join(h.Home, "missing make")}} {
		r := discoverShared(h, opts, nil, true)
		if r.Actions["build"] != nil {
			t.Fatal("explicit invalid path silently replaced")
		}
		if len(r.Alternatives["cubeIDE"]) == 0 {
			t.Fatal("alternatives lost")
		}
		if checkErrors(r.Checks) == "" {
			t.Fatal("invalid path not reported")
		}
	}
}
func TestSymlinksPermissionsAndIndependentCubeMX(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	app := filepath.Join(h.Home, "STM32CubeMX"+h.suffix())
	toolFile(t, app)
	r := discoverShared(h, options{cubeMX: app}, nil, true)
	if r.Actions["cubeMX"]["cubeMX"] == "" {
		t.Fatal("CubeMX blocked by missing optional tools")
	}
	if runtime.GOOS == "windows" {
		return
	}
	link := filepath.Join(h.Home, "alias [] ü")
	if err := os.Symlink(app, link); err != nil {
		t.Fatal(err)
	}
	r = discoverShared(h, options{cubeMX: link}, nil, true)
	c := r.Details["cubeMX"]
	if c.Original != link || c.Resolved != app {
		t.Fatalf("original/resolved lost: %+v", c)
	}
	if err := os.Chmod(app, 0644); err != nil {
		t.Fatal(err)
	}
	if recognizeFile("cubeMX", app, "explicit", h).Valid {
		t.Fatal("non-executable accepted")
	}
	if err := os.Remove(app); err != nil {
		t.Fatal(err)
	}
	if recognizeFile("cubeMX", link, "explicit", h).Valid {
		t.Fatal("broken link accepted")
	}
	a, b := filepath.Join(h.Home, "cycleA"), filepath.Join(h.Home, "cycleB")
	_ = os.Symlink(b, a)
	_ = os.Symlink(a, b)
	if c := recognizeFile("cubeMX", a, "explicit", h); c.Valid || !strings.Contains(c.Reason, "link") {
		t.Fatalf("cycle: %+v", c)
	}
}
func TestWindowsVariablesPATHAndCubeMXVersions(t *testing.T) {
	h := hostFixture(t, "windows")
	h.Roots = nil
	h.Env["ProgramW6432"] = filepath.Join(h.Home, "System Program Files")
	h.Env["LOCALAPPDATA"] = filepath.Join(h.Home, "User Programs")
	root := filepath.Join(h.Env["ProgramW6432"], "STMicroelectronics/STM32Cube/STM32CubeIDE_1.18")
	local := h
	local.Roots = []string{filepath.Dir(root)}
	ideFixture(t, local, filepath.Base(root))
	app := filepath.Join(h.Env["LOCALAPPDATA"], "Programs/STM32CubeMX/STM32CubeMX.exe")
	toolFile(t, app)
	r := discoverShared(h, options{}, nil, true)
	if r.Actions["debug"] == nil || r.Tools["cubeMX"] != app {
		t.Fatalf("system variable layouts: %+v", r)
	}
	if runtime.GOOS == "windows" {
		return
	}
	h = hostFixture(t, "darwin")
	old, newest := filepath.Join(h.Home, "STM32CubeMX-6.9.app"), filepath.Join(h.Home, "STM32CubeMX-6.12.app")
	for _, p := range []string{old, newest} {
		toolFile(t, filepath.Join(p, "Contents/MacOS/STM32CubeMX"))
	}
	r = discoverShared(h, options{}, nil, true)
	if !strings.HasPrefix(r.Tools["cubeMX"], newest) {
		t.Fatalf("CubeMX numeric version order: %+v", r.Tools)
	}
}
func TestToolsProtocolWithoutProjectAndBadArguments(t *testing.T) {
	if err := toolsCommand([]string{"--project", "missing"}); err == nil {
		t.Fatal("project accepted")
	}
	if err := toolsCommand([]string{"--cube-ide"}); err == nil {
		t.Fatal("missing argument accepted")
	}
	h := hostFixture(t, "linux")
	r := discoverShared(h, options{ide: "does not exist"}, nil, true)
	data, err := json.Marshal(r)
	if err != nil || !json.Valid(data) || r.SchemaVersion != 1 {
		t.Fatal("invalid JSON protocol")
	}
}
func TestAutomaticTraversalDoesNotSearchUnrelatedDirectories(t *testing.T) {
	h := hostFixture(t, "linux")
	ideFixture(t, h, "unrelated/deep/STM32CubeIDE_99")
	if r := discoverShared(h, options{}, nil, true); len(r.Actions) > 0 {
		t.Fatal("searched unrelated directory")
	}
}

func TestBuildSetupDoesNotRequireOrReplaceOptionalTools(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture version probes use POSIX shell; discovery layout coverage runs on all OSes")
	}
	root := fixture(t)
	h := hostFixture(t, runtime.GOOS)
	ide := ideFixture(t, h, "STM32CubeIDE_99", "gdb", "server", "programmer", "nm", "objdump")
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadConfigFor(root, "build")
	if err != nil {
		t.Fatal(err)
	}
	if !suitable(cfg.Tools, "build") {
		t.Fatal("build tools missing")
	}
	if cfg.Tools["server"] != "" {
		t.Fatal("unneeded server selected")
	}
	r := inspect(root, options{ide: ide}, false)
	if !r.Configured {
		t.Fatal("partial suitable configuration lost")
	}
	before, _ := os.ReadFile(filepath.Join(root, stateDir, "tools.json"))
	if err := setup(root, options{ide: filepath.Join(root, "bad []"), action: "build"}); err == nil {
		t.Fatal("bad replacement accepted")
	}
	after, _ := os.ReadFile(filepath.Join(root, stateDir, "tools.json"))
	if string(before) != string(after) {
		t.Fatal("failed replacement damaged working tools")
	}
}
func TestExplicitExecutableSettingsSurviveSetup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX executable fixture")
	}
	root := fixture(t)
	h := hostFixture(t, runtime.GOOS)
	ide := ideFixture(t, h, "STM32CubeIDE_99")
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	custom := filepath.Join(root, "custom [ü] make")
	toolFile(t, custom)
	settings, _ := readObject(filepath.Join(root, ".vscode/settings.json"))
	settings["dauhuniec.make"] = custom
	if err := writeJSON(filepath.Join(root, ".vscode/settings.json"), settings); err != nil {
		t.Fatal(err)
	}
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	cfg, err := loadConfigFor(root, "build")
	if err != nil || cfg.Tools["make"] != mustCanonical(t, custom) {
		t.Fatal("explicit tool choice overwritten", err)
	}
}

func mustCanonical(t *testing.T, p string) string {
	t.Helper()
	resolved, err := canonical(p)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func TestUnversionedBundleUsesProductMetadataRatherThanSTM32Digits(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	root := ideFixture(t, h, "STM32CubeIDE.app")
	ideFixture(t, h, "STM32CubeIDE_1.99.app")
	if err := os.WriteFile(filepath.Join(filepath.Dir(mustPlugins(t, root)), ".eclipseproduct"), []byte("name=STM32CubeIDE\nversion=2.1.1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	r := discoverShared(h, options{}, nil, true)
	if !strings.HasPrefix(r.Actions["debug"]["server"], root) {
		t.Fatal("unversioned application's real product version ignored")
	}
	if r.Details["cubeIDE"].Version != "2.1.1" {
		t.Fatal("wrong product metadata")
	}
}

func TestOptionalInvalidUserSettingDoesNotReplaceWorkingSavedTool(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX executable fixture")
	}
	root := fixture(t)
	h := hostFixture(t, runtime.GOOS)
	ide := ideFixture(t, h, "STM32CubeIDE_99")
	if err := setup(root, options{ide: ide}); err != nil {
		t.Fatal(err)
	}
	previous := savedTools(root)["gdb"]
	settings, _ := readObject(filepath.Join(root, ".vscode/settings.json"))
	invalid := filepath.Join(root, "missing explicit GDB")
	settings["dauhuniec.gdb"] = invalid
	if err := writeJSON(filepath.Join(root, ".vscode/settings.json"), settings); err != nil {
		t.Fatal(err)
	}
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	if savedTools(root)["gdb"] != previous {
		t.Fatal("invalid optional choice replaced working saved tool")
	}
	settings, _ = readObject(filepath.Join(root, ".vscode/settings.json"))
	if settings["dauhuniec.gdb"] != invalid {
		t.Fatal("explicit invalid optional setting silently replaced")
	}
}
func TestEqualVersionTieBreakIsStableAcrossRootOrder(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	a := ideFixture(t, h, "STM32CubeIDE_2.1 A")
	b := ideFixture(t, h, "STM32CubeIDE_2.1 B")
	h.Roots = []string{b, a}
	first := discoverShared(h, options{}, nil, true).Actions["debug"]["server"]
	h.Roots = []string{a, b}
	second := discoverShared(h, options{}, nil, true).Actions["debug"]["server"]
	if first != second || !strings.HasPrefix(first, a) {
		t.Fatal("equal-version selection depends on enumeration order")
	}
}
func TestStandalonePATHAndExplicitSourcePrecedence(t *testing.T) {
	h := hostFixture(t, runtime.GOOS)
	dir := filepath.Join(h.Home, "tools [] ü")
	makePath := filepath.Join(dir, "make"+h.suffix())
	mxName := "stm32cubemx"
	if h.OS == "windows" {
		mxName = "STM32CubeMX.exe"
	}
	mx := filepath.Join(dir, mxName)
	toolFile(t, makePath)
	toolFile(t, mx)
	h.Env["PATH"] = dir
	r := discoverShared(h, options{}, nil, true)
	if r.Tools["make"] != makePath || !sameToolFile(r.Tools["cubeMX"], mx) {
		t.Fatal("standalone PATH discovery failed")
	}
	previous := filepath.Join(h.Home, "previous Make")
	explicit := filepath.Join(h.Home, "explicit Make")
	toolFile(t, previous)
	toolFile(t, explicit)
	r = discoverShared(h, options{}, map[string]string{"make": previous}, true)
	if r.Tools["make"] != previous {
		t.Fatal("previous Make did not win")
	}
	r = discoverShared(h, options{make: explicit}, map[string]string{"make": previous}, true)
	if r.Tools["make"] != explicit || r.Details["make"].Source != "explicit" {
		t.Fatal("explicit Make did not win")
	}
}

func sameToolFile(a, b string) bool {
	x, ex := os.Stat(a)
	y, ey := os.Stat(b)
	return ex == nil && ey == nil && os.SameFile(x, y)
}

func mustPlugins(t *testing.T, root string) string {
	t.Helper()
	p, err := pluginDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
