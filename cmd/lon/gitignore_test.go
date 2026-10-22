package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestProjectGitignorePreservesUserRules(t *testing.T) {
	for _, contents := range []string{"", "# My rules\r\ncustom/\r\n!serial-example.jsonl", "\ufeff# My rules\n!debug.log\n"} {
		t.Run(contents, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, ".gitignore")
			if err := os.WriteFile(path, []byte(contents), 0644); err != nil {
				t.Fatal(err)
			}
			if err := createProjectGitignore(root, project{BuildDir: "build"}); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasSuffix(string(data), strings.TrimPrefix(contents, "\ufeff")) {
				t.Fatalf("user rules changed: %q", data)
			}
			if strings.HasPrefix(contents, "\ufeff") && !bytes.HasPrefix(data, []byte("\ufeff")) {
				t.Fatal("BOM lost")
			}
			if strings.Contains(contents, "\r\n") && strings.Contains(strings.ReplaceAll(string(data), "\r\n", ""), "\n") {
				t.Fatal("mixed line endings")
			}
			if err := createProjectGitignore(root, project{BuildDir: "build"}); err != nil {
				t.Fatal(err)
			}
			again, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(data, again) {
				t.Fatalf("setup is not idempotent: %q, %v", again, err)
			}
			if err := createProjectGitignore(root, project{BuildDir: "other-build"}); err != nil {
				t.Fatal(err)
			}
			updated, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(updated, bytes.Replace(data, []byte("/build/"), []byte("/other-build/"), 1)) {
				t.Fatalf("unexpected block update: %q, %v", updated, err)
			}
		})
	}
}

func TestProjectGitignoreRejectsMalformedBlocks(t *testing.T) {
	for _, contents := range []string{
		gitignoreBegin + "\n/build/\n",
		gitignoreEnd + "\n",
		gitignoreEnd + "\n" + gitignoreBegin + "\n",
		gitignoreBegin + "\n" + gitignoreBegin + "\n" + gitignoreEnd + "\n",
		gitignoreBegin + "\n" + gitignoreEnd + "\n" + gitignoreBegin + "\n" + gitignoreEnd + "\n",
	} {
		root := t.TempDir()
		path := filepath.Join(root, ".gitignore")
		if err := os.WriteFile(path, []byte(contents), 0644); err != nil {
			t.Fatal(err)
		}
		if err := createProjectGitignore(root, project{BuildDir: "build"}); err == nil {
			t.Fatal("malformed block accepted")
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != contents {
			t.Fatalf("damaged file: %q, %v", data, err)
		}
	}
}

func TestProjectGitignorePreservesSurroundingRules(t *testing.T) {
	original := "# Before\n*.tmp\n" + gitignoreBegin + "\n/old-build/\n" + gitignoreEnd + "\n# After\n!debug.log"
	updated, err := projectGitignore([]byte(original), project{BuildDir: "build"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(updated, []byte("# Before\n*.tmp\n")) || !bytes.HasSuffix(updated, []byte("# After\n!debug.log")) || bytes.Contains(updated, []byte("/old-build/")) {
		t.Fatalf("unexpected update: %q", updated)
	}
}

func TestProjectGitignoreRejectsUnsafePaths(t *testing.T) {
	for _, build := range []string{"", ".", "../outside", "Core", "build\n*.c", "build*"} {
		root := t.TempDir()
		if err := createProjectGitignore(root, project{BuildDir: build}); err == nil {
			t.Fatalf("accepted BUILD_DIR %q", build)
		}
		if _, err := os.Lstat(filepath.Join(root, ".gitignore")); !os.IsNotExist(err) {
			t.Fatalf("created file for invalid BUILD_DIR: %v", err)
		}
	}
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".gitignore"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := createProjectGitignore(root, project{BuildDir: "build"}); err == nil {
		t.Fatal("directory accepted")
	}
	if runtime.GOOS == "windows" {
		t.Skip("symlinks require privileges on Windows")
	}
	root = t.TempDir()
	outside := filepath.Join(t.TempDir(), "rules")
	if err := os.WriteFile(outside, []byte("custom\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, ".gitignore")); err != nil {
		t.Fatal(err)
	}
	if err := createProjectGitignore(root, project{BuildDir: "build"}); err == nil {
		t.Fatal("symlink accepted")
	}
	data, err := os.ReadFile(outside)
	if err != nil || string(data) != "custom\n" {
		t.Fatalf("symlink target changed: %q, %v", data, err)
	}
}

func TestProjectGitignoreRules(t *testing.T) {
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git is unavailable")
	}
	root := fixture(t)
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("# Shared rules\n!serial-example.jsonl\n!debug.log"), 0644); err != nil {
		t.Fatal(err)
	}
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := createProjectGitignore(root, p); err != nil {
		t.Fatal(err)
	}
	// A later setup refreshes only the managed build directory.
	if err := createProjectGitignore(root, project{BuildDir: "other-build"}); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command(git, "init", root).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s, %v", output, err)
	}
	for path, ignored := range map[string]bool{
		"artifacts/build/Lab02.elf":    false,
		".dauhuniec/tools.json":        true,
		".lon/target.json":             true,
		".stm32-codeready/lon":         true,
		".vscode/settings.json":        true,
		"serial-session.jsonl":         true,
		"debug.log":                    false,
		"serial-example.jsonl":         false,
		"nested/other-build/file.elf":  false,
		"nested/.vscode/settings.json": false,
		"other-build-not/file.elf":     false,
		"capture.jsonl":                false,
		"firmware.bin":                 false,
		"firmware.hex":                 false,
		"docs/debug.log":               false,
		"docs/session.log":             true,
		".DS_Store":                    true,
		"Lab.ioc":                      false,
		"Makefile":                     false,
		"Core/Src/main.c":              false,
		"Drivers/HAL/driver.c":         false,
		"STM32_FLASH.ld":               false,
		".gitignore":                   false,
		"other-build/file.elf":         true,
	} {
		cmd := exec.Command(git, "-C", root, "check-ignore", "--no-index", "-q", "--", path)
		err := cmd.Run()
		if err != nil {
			if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 1 {
				t.Fatalf("git check-ignore %s: %v", path, err)
			}
		}
		if (err == nil) != ignored {
			t.Errorf("%s: ignored = %v, want %v", path, err == nil, ignored)
		}
	}
}

func TestSetupUpdatesProjectGitignore(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture version probes use POSIX shell")
	}
	root := fixture(t)
	h := hostFixture(t, runtime.GOOS)
	ide := ideFixture(t, h, "STM32CubeIDE_99")
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, ".gitignore")
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Contains(data, []byte("/artifacts/build/\n")) {
		t.Fatalf("setup did not generate build rule: %q, %v", data, err)
	}
	data = append(data, []byte("# My exception\n!debug.log")...)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "Makefile"), []byte("TARGET = Lab02\nBUILD_DIR = output/firmware\nall:\n\t$(CC) -c main.c -o $(BUILD_DIR)/main.o\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := setup(root, options{ide: ide, action: "build"}); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(updated, bytes.Replace(data, []byte("/artifacts/build/"), []byte("/output/firmware/"), 1)) {
		t.Fatalf("setup did not refresh build rule: %q, %v", updated, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("permissions changed: %v", info.Mode())
	}
	if err := createProjectGitignore(root, project{BuildDir: "output/firmware"}); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(info, after) || !info.ModTime().Equal(after.ModTime()) {
		t.Fatal("unchanged file was rewritten")
	}
}
