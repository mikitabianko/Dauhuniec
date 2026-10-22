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
	ToolDiscovery *toolsReport      `json:"toolDiscovery,omitempty"`
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
	if runtime.GOOS == "windows" && previous["shell"] != "" && opts.make == previous["make"] {
		opts.make = ""
	}
	r := discoverShared(currentToolHost(), opts, previous, false)
	d := discovery{Tools: r.Tools}
	for _, c := range r.Checks {
		if c.ID != "cubeMX" {
			d.Checks = append(d.Checks, c)
		}
	}
	if c, ok := r.Details["cubeIDE"]; ok {
		d.Plugins = c.Installation
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
	if opts.diagnostics {
		shared := discoverShared(currentToolHost(), opts, savedTools(root), true)
		r.ToolDiscovery = &shared
	}
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
	if _, err := loadConfigFor(root, "clean"); err == nil {
		settings, err := readObject(filepath.Join(root, ".vscode/settings.json"))
		if err == nil && settings["dauhuniec.runner"] == filepath.Join(root, stateDir, binaryName()) && regularFile(filepath.Join(root, ".vscode/tasks.json")) {
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
