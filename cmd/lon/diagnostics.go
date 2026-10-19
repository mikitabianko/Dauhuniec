package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type check struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Action  string `json:"action,omitempty"`
}

type discovery struct {
	Plugins string
	Tools   map[string]string
	Checks  []check
}

type report struct {
	SchemaVersion int               `json:"schemaVersion"`
	Version       string            `json:"version"`
	Root          string            `json:"root"`
	Project       *project          `json:"project,omitempty"`
	Configured    bool              `json:"configured"`
	Ready         bool              `json:"ready"`
	Checks        []check           `json:"checks"`
	Tools         map[string]string `json:"tools"`
}

func savedTools(root string) map[string]string {
	var cfg config
	data, err := os.ReadFile(filepath.Join(root, stateDir, "tools.json"))
	if os.IsNotExist(err) {
		data, err = os.ReadFile(filepath.Join(root, previousStateDir, "tools.json"))
	}
	if os.IsNotExist(err) {
		data, err = os.ReadFile(filepath.Join(root, legacyStateDir, "tools.json"))
	}
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	return cfg.Tools
}

func discoverTools(opts options, previous map[string]string) discovery {
	d := discovery{Tools: make(map[string]string)}
	ide := opts.ide
	if ide == "" && regularFile(previous["gcc"]) {
		ide = filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(previous["gcc"]))))
	}
	plugins, err := findPlugins(ide)
	if err != nil {
		d.Checks = append(d.Checks, check{"cubeide", "STM32CubeIDE tools", "error", err.Error(), "selectCubeIDE"})
	} else {
		d.Plugins = plugins
		d.Checks = append(d.Checks, check{"cubeide", "STM32CubeIDE tools", "ok", plugins, ""})
		for _, tool := range []struct{ key, family, binary string }{
			{"gcc", "gnu-tools-for-stm32", "arm-none-eabi-gcc"},
			{"gdb", "gnu-tools-for-stm32", "arm-none-eabi-gdb"},
			{"objcopy", "gnu-tools-for-stm32", "arm-none-eabi-objcopy"},
			{"objdump", "gnu-tools-for-stm32", "arm-none-eabi-objdump"},
			{"nm", "gnu-tools-for-stm32", "arm-none-eabi-nm"},
			{"size", "gnu-tools-for-stm32", "arm-none-eabi-size"},
			{"server", "stlink-gdb-server", "ST-LINK_gdbserver"},
			{"programmer", "cubeprogrammer", "STM32_Programmer_CLI"},
		} {
			path, err := findTool(plugins, tool.family, tool.binary)
			if err != nil {
				d.Checks = append(d.Checks, check{tool.key, tool.binary, "error", err.Error(), "selectCubeIDE"})
			} else {
				d.Tools[tool.key] = path
				d.Checks = append(d.Checks, check{tool.key, tool.binary, "ok", path, ""})
			}
		}
	}
	makePath := opts.make
	if makePath == "" && regularFile(previous["make"]) {
		makePath = previous["make"]
	}
	if makePath == "" {
		if runtime.GOOS == "windows" {
			makePath = "C:/msys64/usr/bin/make.exe"
		} else {
			makePath, _ = exec.LookPath("make")
		}
	}
	if !regularFile(makePath) {
		d.Checks = append(d.Checks, check{"make", "GNU Make", "error", "Install GNU Make (Windows: MSYS2 make and shell), or choose its executable.", "selectMake"})
	} else {
		path, err := canonical(makePath)
		if err != nil {
			d.Checks = append(d.Checks, check{"make", "GNU Make", "error", err.Error(), "selectMake"})
		} else {
			d.Tools["make"] = path
			d.Checks = append(d.Checks, check{"make", "GNU Make", "ok", path, ""})
			if runtime.GOOS == "windows" {
				shell := filepath.Join(filepath.Dir(path), "sh.exe")
				if regularFile(shell) {
					d.Tools["shell"] = shell
				} else {
					d.Checks = append(d.Checks, check{"shell", "MSYS2 shell", "error", "Choose MSYS2 make.exe with sh.exe in the same bin directory.", "selectMake"})
				}
			}
		}
	}
	return d
}

func checkErrors(checks []check) string {
	var problems []string
	for _, item := range checks {
		if item.Status == "error" {
			problems = append(problems, item.Message)
		}
	}
	return strings.Join(problems, "\n")
}

func inspect(root string, opts options, verify bool) report {
	r := report{SchemaVersion: 1, Version: version, Root: root}
	p, err := readProject(root)
	if err != nil {
		r.Checks = append(r.Checks, check{"project", "CubeMX project", "error", err.Error(), "generateMakefile"})
	} else {
		r.Project = &p
		r.Checks = append(r.Checks, check{"project", "CubeMX project", "ok", p.Target + " · " + p.Device, ""})
	}
	d := discoverTools(opts, savedTools(root))
	r.Tools = d.Tools
	r.Checks = append(r.Checks, d.Checks...)
	if verify {
		for _, key := range []string{"gcc", "gdb", "make"} {
			tool := r.Tools[key]
			if tool == "" {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			command := exec.CommandContext(ctx, tool, "--version")
			command.Dir = root
			output, err := command.CombinedOutput()
			cancel()
			status, action := "ok", ""
			message := strings.SplitN(strings.TrimSpace(string(output)), "\n", 2)[0]
			if err != nil {
				status, action = "error", "selectCubeIDE"
				if key == "make" {
					action = "selectMake"
				}
				message = fmt.Sprintf("Cannot launch %s: %v. %s", key, err, message)
			}
			r.Checks = append(r.Checks, check{key + ".launch", key + " launch", status, message, action})
		}
	}
	if existing, err := loadConfig(root); err == nil {
		sameTools := true
		for key, path := range d.Tools {
			if existing.Tools[key] != path {
				sameTools = false
			}
		}
		settings, err := readObject(filepath.Join(root, ".vscode/settings.json"))
		if sameTools && err == nil && settings["dauhuniec.runner"] == filepath.Join(root, stateDir, binaryName()) && regularFile(filepath.Join(root, ".vscode/tasks.json")) {
			r.Configured = true
		}
	}
	if r.Configured {
		r.Checks = append(r.Checks, check{"configuration", "VS Code configuration", "ok", "Dauhuniec is configured for this project.", ""})
	} else {
		r.Checks = append(r.Checks, check{"configuration", "VS Code configuration", "warning", "Configure this project to enable build and debug tasks.", "configure"})
	}
	r.Ready = r.Configured && checkErrors(r.Checks) == ""
	return r
}

func printReport(r report, asJSON bool) error {
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(r)
	}
	for _, item := range r.Checks {
		fmt.Printf("[%s] %s: %s\n", item.Status, item.Label, item.Message)
	}
	if problems := checkErrors(r.Checks); problems != "" {
		return fmt.Errorf("environment needs attention")
	}
	return nil
}
