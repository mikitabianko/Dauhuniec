package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for name, data := range map[string]string{
		"Lab.ioc":  "Mcu.CPN=STM32F429ZIT6\r\nProjectManager.TargetToolchain=Makefile\r\n",
		"Makefile": "TARGET = Lab02\nBUILD_DIR := artifacts/build\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestCubeMXProjectAndRejectedInputs(t *testing.T) {
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if p.Target != "Lab02" || p.BuildDir != "artifacts/build" {
		t.Fatalf("wrong project: %+v", p)
	}
	for _, ioc := range []string{
		"Mcu.CPN=STM32F429ZIT6\nProjectManager.TargetToolchain=EWARM V8.50\n",
		"Mcu.CPN=STM32MP157AAA3\nProjectManager.TargetToolchain=Makefile\n",
	} {
		if err := os.WriteFile(filepath.Join(root, "Lab.ioc"), []byte(ioc), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := readProject(root); err == nil {
			t.Fatal("unsupported project accepted")
		}
	}
}

func TestCleanCannotRemoveRootSourcesOrTraverseLinks(t *testing.T) {
	root := fixture(t)
	for _, name := range []string{".", "../outside", "/tmp", "build/../Core", "Core", "Drivers", ".git", stateDir, "$(OUTPUT)", "C:/test"} {
		t.Run(name, func(t *testing.T) {
			if err := checkBuildDir(root, name); err == nil {
				t.Fatalf("unsafe path accepted: %s", name)
			}
		})
	}
	if runtime.GOOS != "windows" {
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(root, "build")); err != nil {
			t.Fatal(err)
		}
		if err := checkBuildDir(root, "build/subdir"); err == nil {
			t.Fatal("symlink accepted")
		}
	}
}

func TestFlashStopsAfterFailedBuild(t *testing.T) {
	count := 0
	err := perform(t.TempDir(), "flash", config{Project: project{BuildDir: "build"}, Tools: map[string]string{"make": "make"}},
		func(_ string, cmd, _ []string) error {
			count++
			if cmd[0] != "make" {
				t.Fatalf("programmer called: %v", cmd)
			}
			return errors.New("compile failed")
		})
	if err == nil || count != 1 {
		t.Fatalf("wrong failure behavior: calls=%d, error=%v", count, err)
	}
}

func TestFlashUsesProjectELFAndVerifies(t *testing.T) {
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(elfPath(root, p)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(elfPath(root, p), []byte("test ELF"), 0644); err != nil {
		t.Fatal(err)
	}
	var commands [][]string
	err = perform(root, "flash", config{Project: p, Tools: map[string]string{"make": "make", "programmer": "programmer"}},
		func(_ string, command, _ []string) error { commands = append(commands, command); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 2 || commands[1][4] != elfPath(root, p) || strings.Join(commands[1][5:], " ") != "-v -rst" {
		t.Fatalf("wrong flash command: %v", commands)
	}
}

func TestSetupBacksUpVSCodeAndUsesNativeRunner(t *testing.T) {
	root := fixture(t)
	state := filepath.Join(root, stateDir)
	for _, dir := range []string{state, filepath.Join(root, ".vscode")} {
		if err := os.Mkdir(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	old := []byte("{\"editor.fontSize\": 17}\n")
	if err := os.WriteFile(filepath.Join(root, ".vscode/settings.json"), old, 0644); err != nil {
		t.Fatal(err)
	}
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config{Project: p, Tools: map[string]string{"programmer": "programmer"}}
	if err := configureVSCode(root, "no-plugins", cfg); err != nil {
		t.Fatal(err)
	}
	backups, err := filepath.Glob(filepath.Join(state, "backups/*/settings.json"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("missing backup: %v, %v", backups, err)
	}
	data, err := os.ReadFile(backups[0])
	if err != nil || string(data) != string(old) {
		t.Fatal("backup changed")
	}
	data, err = os.ReadFile(filepath.Join(root, ".vscode/settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	if settings["dauhuniec.runner"] != filepath.Join(state, binaryName()) || settings["dauhuniec.elf"] != elfPath(root, p) {
		t.Fatalf("wrong settings: %s", data)
	}
	data, err = os.ReadFile(filepath.Join(root, ".vscode/tasks.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "python") || !strings.Contains(string(data), "dauhuniec.runner") {
		t.Fatal("tasks require an interpreter")
	}
}

func TestVersionAndOptionSelection(t *testing.T) {
	if !naturalLess("tools.9.0", "tools.14.3") {
		t.Fatal("wrong version order")
	}
	opts, err := parseOptions([]string{"project with spaces", "--cube-ide", "IDE with spaces", "--make", "make"}, true)
	if err != nil || opts.project != "project with spaces" || opts.ide != "IDE with spaces" {
		t.Fatalf("%+v, %v", opts, err)
	}
	if _, err := parseOptions([]string{"--make"}, true); err == nil {
		t.Fatal("missing flag value accepted")
	}
	if _, err := parseOptions([]string{"--make", "make"}, false); err == nil {
		t.Fatal("setup option accepted for runtime command")
	}
}

func TestUploadUsesExistingELFWithoutBuilding(t *testing.T) {
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(elfPath(root, p)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(elfPath(root, p), []byte("existing ELF"), 0644); err != nil {
		t.Fatal(err)
	}
	var commands [][]string
	err = perform(root, "upload", config{Project: p, Tools: map[string]string{"make": "make", "programmer": "programmer"}},
		func(_ string, command, _ []string) error { commands = append(commands, command); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(commands) != 1 || strings.Join(commands[0], " ") != "programmer -c port=SWD -w "+elfPath(root, p)+" -v -rst" {
		t.Fatalf("upload must only program the existing ELF: %v", commands)
	}
}

func TestUploadWithoutELFDoesNotBuildOrProgram(t *testing.T) {
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	err = perform(root, "upload", config{Project: p}, func(_ string, command, _ []string) error {
		t.Fatalf("must not run tools when ELF is missing: %v", command)
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "run Build Firmware first") {
		t.Fatalf("expected missing firmware guidance, got %v", err)
	}
}

func TestUploadPropagatesProgrammerFailure(t *testing.T) {
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(elfPath(root, p)), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(elfPath(root, p), []byte("existing ELF"), 0644); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("ST-LINK disconnected")
	err = perform(root, "upload", config{Project: p}, func(_ string, _, _ []string) error { return failure })
	if !errors.Is(err, failure) {
		t.Fatalf("programmer failure lost: %v", err)
	}
}
