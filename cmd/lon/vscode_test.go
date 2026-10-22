package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
