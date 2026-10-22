package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// VS Code files support comments and trailing commas. Decode those without
// altering strings, URLs or escaped quotes; original formatting stays in backup.
func decodeJSONC(data []byte, value any) error {
	clean := append([]byte(nil), data...)
	inString, escaped := false, false
	for i := 0; i < len(clean); i++ {
		c := clean[i]
		if inString {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			continue
		}
		if c != '/' || i+1 == len(clean) {
			continue
		}
		if clean[i+1] == '/' {
			for i < len(clean) && clean[i] != '\n' {
				clean[i] = ' '
				i++
			}
		} else if clean[i+1] == '*' {
			clean[i], clean[i+1] = ' ', ' '
			i += 2
			closed := false
			for i < len(clean) {
				if i+1 < len(clean) && clean[i] == '*' && clean[i+1] == '/' {
					clean[i], clean[i+1] = ' ', ' '
					i++
					closed = true
					break
				}
				if clean[i] != '\n' {
					clean[i] = ' '
				}
				i++
			}
			if !closed {
				return fmt.Errorf("unclosed JSON comment")
			}
		}
	}
	inString, escaped = false, false
	for i, c := range clean {
		if inString {
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			continue
		}
		if c == ',' {
			j := i + 1
			for j < len(clean) && strings.ContainsRune(" \t\r\n", rune(clean[j])) {
				j++
			}
			if j < len(clean) && (clean[j] == '}' || clean[j] == ']') {
				clean[i] = ' '
			}
		}
	}
	return json.Unmarshal(clean, value)
}

func readObject(path string) (map[string]any, error) {
	value := make(map[string]any)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return value, nil
	}
	if err != nil {
		return nil, err
	}
	if err := decodeJSONC(data, &value); err != nil {
		return nil, fmt.Errorf("cannot read %s: %w (file left unchanged)", path, err)
	}
	if value == nil {
		return nil, fmt.Errorf("expected a JSON object in %s", path)
	}
	return value, nil
}

func mergeEntries(old, fresh any, managed func(map[string]any) bool) []any {
	var result []any
	if entries, ok := old.([]any); ok {
		for _, entry := range entries {
			object, ok := entry.(map[string]any)
			if !ok || !managed(object) {
				result = append(result, entry)
			}
		}
	}
	if entries, ok := fresh.([]any); ok {
		result = append(result, entries...)
	}
	return result
}

func unique(values []string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func compilerConfiguration(root string, template map[string]any) map[string]any {
	data, _ := os.ReadFile(filepath.Join(root, "Makefile"))
	text := strings.ReplaceAll(string(data), "\\\r\n", " ")
	text = strings.ReplaceAll(text, "\\\n", " ")
	variables := map[string]string{}
	for _, match := range regexp.MustCompile(`(?m)^[\t ]*([A-Za-z_][A-Za-z0-9_-]*)[\t ]*:?=[\t ]*([^#\r\n]+)`).FindAllStringSubmatch(text, -1) {
		variables[match[1]] = strings.TrimSpace(match[2])
	}
	references := regexp.MustCompile(`\$\(([A-Za-z_][A-Za-z0-9_-]*)\)`)
	for pass := 0; pass < 8; pass++ {
		expanded := references.ReplaceAllStringFunc(text, func(reference string) string {
			if value, ok := variables[reference[2:len(reference)-1]]; ok {
				return value
			}
			return reference
		})
		if expanded == text {
			break
		}
		text = expanded
	}
	var defines, includes, args []string
	for _, match := range regexp.MustCompile(`(?:^|\s)-D([^\s\\]+)`).FindAllStringSubmatch(text, -1) {
		if !strings.ContainsAny(match[1], "$()") {
			defines = append(defines, match[1])
		}
	}
	for _, match := range regexp.MustCompile(`(?:^|\s)-I([^\s\\]+)`).FindAllStringSubmatch(text, -1) {
		path := strings.Trim(match[1], "\"")
		if !strings.ContainsAny(path, "$()") {
			if !filepath.IsAbs(path) {
				path = "${workspaceFolder}/" + filepath.ToSlash(path)
			}
			includes = append(includes, path)
		}
	}
	for _, match := range regexp.MustCompile(`-m(?:cpu=[^\s\\]+|fpu=[^\s\\]+|float-abi=[^\s\\]+|thumb\b)`).FindAllString(text, -1) {
		args = append(args, match)
	}
	if len(includes) == 0 {
		includes = []string{"${workspaceFolder}/Core/Inc", "${workspaceFolder}/Drivers/**"}
	}
	template["name"] = "Dauhuniec"
	template["defines"], template["includePath"], template["compilerArgs"] = unique(defines), unique(includes), unique(args)
	return template
}

func migrateSettings(old map[string]any) {
	for _, prefix := range []string{"lon.", "codeready."} {
		for key, value := range old {
			if strings.HasPrefix(key, prefix) {
				renamed := "dauhuniec." + strings.TrimPrefix(key, prefix)
				if _, exists := old[renamed]; !exists {
					old[renamed] = value
				}
				delete(old, key)
			}
		}
	}
	if shell, _ := old["dauhuniec.shell"].(string); shell != "" && old["dauhuniec.makePath"] == old["dauhuniec.make"] {
		delete(old, "dauhuniec.makePath")
	}
	delete(old, "dauhuniec.shell")
}

func configureVSCode(root, plugins string, cfg config) error {
	destination := filepath.Join(root, ".vscode")
	previous := savedTools(root)
	documents := make(map[string]map[string]any)
	files := []string{"tasks.json", "launch.json", "c_cpp_properties.json", "extensions.json", "settings.json"}
	for _, name := range files {
		old, err := readObject(filepath.Join(destination, name))
		if err != nil {
			return err
		}
		if name == "settings.json" {
			migrateSettings(old)
			// Keep one language server and use the database expanded from Make recipes.
			old["C_Cpp.intelliSenseEngine"] = "disabled"
			old["clangd.enable"] = true
			old["clangd.enableCodeCompletion"] = true
			old["clangd.enableHover"] = true
			old["stm32cube-ide-clangd.enable"] = false
			old["editor.semanticHighlighting.enabled"] = true
			for _, language := range []string{"[c]", "[cpp]"} {
				settings, ok := old[language].(map[string]any)
				if !ok {
					settings = map[string]any{}
				}
				settings["editor.semanticHighlighting.enabled"] = true
				old[language] = settings
			}
			old["clangd.arguments"] = clangdArguments(root, cfg.Tools["gcc"], old["clangd.arguments"])
			for key, value := range cfg.Tools {
				if chosen, ok := old["dauhuniec."+key].(string); ok && chosen != "" && chosen != previous[key] {
					continue
				}
				old["dauhuniec."+key] = value
			}
			old["dauhuniec.runner"] = filepath.Join(root, stateDir, binaryName())
			old["dauhuniec.programmerDir"] = filepath.Dir(cfg.Tools["programmer"])
			old["dauhuniec.elf"], old["dauhuniec.device"] = elfPath(root, cfg.Project), cfg.Project.Device
			documents[name] = old
			continue
		}
		data, err := assets.ReadFile("templates/vscode/" + name)
		if err != nil {
			return err
		}
		var fresh map[string]any
		if err := json.Unmarshal(data, &fresh); err != nil {
			return err
		}
		switch name {
		case "tasks.json":
			managed := func(item map[string]any) bool {
				label, _ := item["label"].(string)
				return strings.HasPrefix(label, "Dauhuniec:") || strings.HasPrefix(label, "Lon-daŭhuniec:") || strings.HasPrefix(label, "CodeReady:") || item["command"] == "${config:dauhuniec.runner}" || item["command"] == "${config:lon.runner}" || item["command"] == "${config:codeready.runner}"
			}
			// Preserve the user's existing default build task.
			if entries, ok := old["tasks"].([]any); ok {
				for _, entry := range entries {
					item, ok := entry.(map[string]any)
					if !ok || managed(item) {
						continue
					}
					group, ok := item["group"].(map[string]any)
					if ok && group["kind"] == "build" && group["isDefault"] == true {
						for _, task := range fresh["tasks"].([]any) {
							if g, ok := task.(map[string]any)["group"].(map[string]any); ok {
								g["isDefault"] = false
							}
						}
					}
				}
			}
			old["tasks"] = mergeEntries(old["tasks"], fresh["tasks"], managed)
		case "launch.json":
			prefix := cfg.Project.Device
			if len(prefix) > 9 {
				prefix = prefix[:9]
			}
			var svds []string
			for _, dir := range children(plugins, func(n string) bool { return strings.HasPrefix(n, "com.st.stm32cube.ide.mcu.productdb.debug_") }) {
				candidate := filepath.Join(dir, "resources/cmsis/STMicroelectronics_CMSIS_SVD", prefix+".svd")
				if regularFile(candidate) {
					svds = append(svds, candidate)
				}
			}
			descending(svds)
			if len(svds) > 0 {
				for _, entry := range fresh["configurations"].([]any) {
					entry.(map[string]any)["svdFile"] = svds[0]
				}
			}
			old["configurations"] = mergeEntries(old["configurations"], fresh["configurations"], func(item map[string]any) bool {
				name, _ := item["name"].(string)
				return strings.HasPrefix(name, "Dauhuniec:") || strings.HasPrefix(name, "Lon-daŭhuniec:") || strings.HasPrefix(name, "CodeReady:") || item["executable"] == "${config:dauhuniec.elf}" || item["executable"] == "${config:lon.elf}" || item["executable"] == "${config:codeready.elf}"
			})
		case "c_cpp_properties.json":
			entries := fresh["configurations"].([]any)
			entries[0].(map[string]any)["compileCommands"] = []string{"${workspaceFolder}/" + stateDir + "/compile_commands.json"}
			old["configurations"] = mergeEntries(old["configurations"], entries, func(item map[string]any) bool {
				return item["compilerPath"] == "${config:dauhuniec.gcc}" || item["name"] == "Dauhuniec" || item["compilerPath"] == "${config:lon.gcc}" || item["name"] == "Lon-daŭhuniec" || item["compilerPath"] == "${config:codeready.gcc}" || item["name"] == "CodeReady"
			})
		case "extensions.json":
			var values []string
			for _, value := range []any{old["recommendations"], fresh["recommendations"]} {
				if entries, ok := value.([]any); ok {
					for _, entry := range entries {
						if name, ok := entry.(string); ok && name != "ms-vscode.cpptools" {
							values = append(values, name)
						}
					}
				}
			}
			old["recommendations"] = unique(values)
		}
		if _, ok := old["version"]; !ok {
			if value, ok := fresh["version"]; ok {
				old["version"] = value
			}
		}
		documents[name] = old
	}
	entries, err := os.ReadDir(destination)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		backups := filepath.Join(root, stateDir, "backups")
		if err := realDir(backups); err != nil {
			return err
		}
		backup := filepath.Join(backups, "vscode-"+time.Now().Format("20060102-150405.000000000"))
		if err := copyTree(destination, backup); err != nil {
			return err
		}
		fmt.Println("Previous VS Code settings saved to", backup)
	}
	for _, name := range files {
		if err := writeJSON(filepath.Join(destination, name), documents[name]); err != nil {
			return err
		}
	}
	return nil
}

// Replace only arguments owned by setup; preserve unrelated user options.
func clangdArguments(root, gcc string, previous any) []string {
	args := []string{}
	if values, ok := previous.([]any); ok {
		for i := 0; i < len(values); i++ {
			value, ok := values[i].(string)
			if !ok {
				continue
			}
			if value == "--compile-commands-dir" || value == "--query-driver" {
				i++
				continue
			}
			if strings.HasPrefix(value, "--compile-commands-dir=") || strings.HasPrefix(value, "--query-driver=") || value == "--background-index" || strings.HasPrefix(value, "--background-index=") {
				continue
			}
			args = append(args, value)
		}
	}
	args = append(args, "--background-index", "--compile-commands-dir="+filepath.Join(root, stateDir))
	if gcc != "" {
		driver := filepath.ToSlash(gcc)
		cxx := strings.TrimSuffix(strings.TrimSuffix(driver, ".exe"), "gcc") + "g++"
		if strings.HasSuffix(driver, ".exe") {
			cxx += ".exe"
		}
		args = append(args, "--query-driver="+driver+","+cxx)
	}
	return args
}
