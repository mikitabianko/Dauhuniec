package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestGeneratedWorkspaceKeepsMakefileAsBuildSystem(t *testing.T) {
	for _, rootCMake := range []bool{false, true} {
		name := "vendor CMake only"
		if rootCMake {
			name = "root CMake project"
		}
		t.Run(name, func(t *testing.T) {
			root := fixture(t)
			for _, dir := range []string{stateDir, ".vscode", "Drivers/CMSIS"} {
				if err := os.MkdirAll(filepath.Join(root, dir), 0755); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(root, "Drivers/CMSIS/CMakeLists.txt"), []byte("project(CMSIS)\n"), 0644); err != nil {
				t.Fatal(err)
			}
			if rootCMake {
				if err := os.WriteFile(filepath.Join(root, "CMakeLists.txt"), []byte("project(App)\n"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			settingsPath := filepath.Join(root, ".vscode/settings.json")
			original := map[string]any{
				"cmake.sourceDirectory":                                "${workspaceFolder}/Drivers/CMSIS",
				"cmake.configureOnOpen":                                true,
				"cmake.configureOnEdit":                                true,
				"cmake.autoDetectSourceDirectory":                      true,
				"cmake.ignoreCMakeListsMissing":                        false,
				"stm32cube-ide-build-cmake.ignoreCubeProjectDiscovery": false,
				"cmake.generator":                                      "Ninja",
				"editor.fontSize":                                      17,
				"[c]":                                                  map[string]any{"editor.tabSize": 4},
				"[cpp]":                                                map[string]any{"editor.formatOnSave": true},
			}
			if err := writeJSON(settingsPath, original); err != nil {
				t.Fatal(err)
			}
			p, err := readProject(root)
			if err != nil {
				t.Fatal(err)
			}
			var first map[string]any
			for attempt := 0; attempt < 2; attempt++ {
				if err := configureVSCode(root, "no-plugins", config{Project: p}); err != nil {
					t.Fatal(err)
				}
				settings, err := readObject(settingsPath)
				if err != nil {
					t.Fatal(err)
				}
				want := map[string]any{
					"cmake.sourceDirectory":                                "${workspaceFolder}",
					"cmake.configureOnOpen":                                false,
					"cmake.configureOnEdit":                                false,
					"cmake.autoDetectSourceDirectory":                      false,
					"cmake.ignoreCMakeListsMissing":                        true,
					"stm32cube-ide-build-cmake.ignoreCubeProjectDiscovery": true,
				}
				for key, value := range want {
					if rootCMake {
						value = original[key]
					}
					if settings[key] != value {
						t.Fatalf("%s: want %v, got %v", key, value, settings[key])
					}
				}
				if settings["cmake.generator"] != "Ninja" || settings["editor.fontSize"] != float64(17) || settings["[c]"].(map[string]any)["editor.tabSize"] != float64(4) || settings["[cpp]"].(map[string]any)["editor.formatOnSave"] != true {
					t.Fatal("unrelated build or language preferences lost", settings)
				}
				if attempt == 0 {
					first = settings
				} else if !reflect.DeepEqual(first, settings) {
					t.Fatal("repeated generation changed workspace settings")
				}
			}
			tasks, err := readObject(filepath.Join(root, ".vscode/tasks.json"))
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range tasks["tasks"].([]any) {
				task := entry.(map[string]any)
				args := task["args"].([]any)
				if len(args) != 3 || args[1] != "--project" || args[2] != "${workspaceFolder}" || task["type"] != "process" {
					t.Fatalf("task is not pinned to its project: %+v", task)
				}
			}
		})
	}
}

func TestConfigureRestoresIntelliSenseAndBacksUpPreferences(t *testing.T) {
	for _, engine := range []string{"", "default", "disabled", "Tag Parser"} {
		t.Run(engine, func(t *testing.T) {
			root := fixture(t)
			for _, dir := range []string{stateDir, ".vscode"} {
				if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
					t.Fatal(err)
				}
			}
			settingsPath := filepath.Join(root, ".vscode/settings.json")
			old := map[string]any{
				"editor.fontSize":             17,
				"clangd.enable":               true,
				"stm32cube-ide-clangd.enable": true,
				"clangd.arguments":            []string{"--log=verbose", "--background-index-priority=low", "--background-index=false", "--compile-commands-dir=old", "--query-driver=old"},
			}
			if engine != "" {
				old["C_Cpp.intelliSenseEngine"] = engine
			}
			if err := writeJSON(settingsPath, old); err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(settingsPath)
			if err != nil {
				t.Fatal(err)
			}
			p, err := readProject(root)
			if err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if err := configureVSCode(root, "no-plugins", config{Project: p}); err != nil {
					t.Fatal(err)
				}
				settings, err := readObject(settingsPath)
				if err != nil {
					t.Fatal(err)
				}
				if settings["C_Cpp.intelliSenseEngine"] != "disabled" || settings["clangd.enable"] != true || settings["stm32cube-ide-clangd.enable"] != false {
					t.Fatalf("competing or disabled language servers: %+v", settings)
				}

				args := settings["clangd.arguments"].([]any)
				joined := ""
				for _, arg := range args {
					joined += arg.(string) + "\n"
				}
				if !strings.Contains(joined, "--background-index-priority=low\n") {
					t.Fatal("unrelated indexing option lost")
				}
				if strings.Contains(joined, "=old") || strings.Count(joined, "--background-index\n") != 1 || !strings.Contains(joined, "--compile-commands-dir="+filepath.Join(root, stateDir)) {
					t.Fatalf("stale clangd arguments: %v", args)
				}
				if settings["editor.semanticHighlighting.enabled"] != true {
					t.Fatal("semantic highlighting disabled")
				}
				if settings["editor.fontSize"] != float64(17) || settings["clangd.arguments"].([]any)[0] != "--log=verbose" {
					t.Fatalf("unrelated preferences lost: %+v", settings)
				}
			}
			backups, err := filepath.Glob(filepath.Join(root, stateDir, "backups/*/settings.json"))
			if err != nil || len(backups) != 2 {
				t.Fatalf("missing backups: %v, %v", backups, err)
			}
			backup, err := os.ReadFile(backups[0])
			if err != nil || string(backup) != string(original) {
				t.Fatalf("original language settings not backed up: %s, %v", backup, err)
			}
		})
	}
}
