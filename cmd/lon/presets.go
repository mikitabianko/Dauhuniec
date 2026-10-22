package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const presetsFile = "dauhuniec.json"

type buildPreset struct {
	Extends      string   `json:"extends,omitempty"`
	Debug        *bool    `json:"debug,omitempty"`
	Optimization string   `json:"optimization,omitempty"`
	BuildFlags   []string `json:"build_flags,omitempty"`
	CFlags       []string `json:"c_flags,omitempty"`
	CXXFlags     []string `json:"cxx_flags,omitempty"`
	ASFlags      []string `json:"asm_flags,omitempty"`
	LDFlags      []string `json:"link_flags,omitempty"`
}
type presetConfig struct {
	Default string                 `json:"default_preset"`
	Presets map[string]buildPreset `json:"presets"`
}
type presetReport struct {
	Active         string   `json:"active"`
	Names          []string `json:"presets"`
	SelectionError string   `json:"selectionError,omitempty"`
}

var presetName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func builtinPresets() presetConfig {
	yes, no := true, false
	return presetConfig{Default: "debug", Presets: map[string]buildPreset{
		"debug":          {Debug: &yes, Optimization: "-Og"},
		"release":        {Debug: &no, Optimization: "-O2"},
		"size":           {Debug: &no, Optimization: "-Os"},
		"relwithdebinfo": {Debug: &yes, Optimization: "-O2"},
	}}
}
func readPresets(root string) (presetConfig, error) {
	cfg := builtinPresets()
	data, err := os.ReadFile(filepath.Join(root, presetsFile))
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	// Built-ins remain available; matching entries replace their definitions.
	var custom *presetConfig
	if err := decodeJSONC(data, &custom); err != nil {
		return cfg, fmt.Errorf("%s: %w", presetsFile, err)
	}
	if custom == nil {
		return cfg, fmt.Errorf("%s: expected a JSON object", presetsFile)
	}
	if custom.Default != "" {
		cfg.Default = custom.Default
	}
	for name, p := range custom.Presets {
		cfg.Presets[name] = p
	}
	for name := range cfg.Presets {
		if !presetName.MatchString(name) {
			return cfg, fmt.Errorf("invalid preset name %q", name)
		}
		if _, err := resolvePreset(cfg, name, map[string]bool{}); err != nil {
			return cfg, err
		}
	}
	if _, ok := cfg.Presets[cfg.Default]; !ok {
		return cfg, fmt.Errorf("unknown default preset %q", cfg.Default)
	}
	return cfg, nil
}
func resolvePreset(cfg presetConfig, name string, seen map[string]bool) (buildPreset, error) {
	p, ok := cfg.Presets[name]
	if !ok {
		return p, fmt.Errorf("unknown build preset %q", name)
	}
	if seen[name] {
		return p, fmt.Errorf("build preset inheritance cycle at %q", name)
	}
	seen[name] = true
	if p.Extends != "" {
		parent, err := resolvePreset(cfg, p.Extends, seen)
		if err != nil {
			return p, err
		}
		if p.Debug == nil {
			p.Debug = parent.Debug
		}
		if p.Optimization == "" {
			p.Optimization = parent.Optimization
		}
		p.BuildFlags = append(parent.BuildFlags, p.BuildFlags...)
		p.CFlags = append(parent.CFlags, p.CFlags...)
		p.CXXFlags = append(parent.CXXFlags, p.CXXFlags...)
		p.ASFlags = append(parent.ASFlags, p.ASFlags...)
		p.LDFlags = append(parent.LDFlags, p.LDFlags...)
	}
	if p.Debug == nil {
		v := true
		p.Debug = &v
	}
	if p.Optimization == "" {
		p.Optimization = "-Og"
	}
	if !regexp.MustCompile(`^-O(0|1|2|3|g|s|z|fast)$`).MatchString(p.Optimization) {
		return p, fmt.Errorf("preset %s: invalid optimization %q", name, p.Optimization)
	}
	for _, flags := range [][]string{p.BuildFlags, p.CFlags, p.CXXFlags, p.ASFlags, p.LDFlags} {
		for _, flag := range flags {
			if strings.ContainsAny(flag, "\r\n\x00") {
				return p, fmt.Errorf("preset %s: flags must be single-line strings", name)
			}
		}
	}
	p.Extends = ""
	return p, nil
}
func activePreset(root, explicit string) (string, presetConfig, error) {
	cfg, err := readPresets(root)
	if err != nil {
		return "", cfg, err
	}
	name := explicit
	if name == "" {
		data, e := os.ReadFile(filepath.Join(root, stateDir, "build-preset.json"))
		if e == nil {
			if e = json.Unmarshal(data, &name); e != nil {
				return "", cfg, e
			}
		} else if !os.IsNotExist(e) {
			return "", cfg, e
		}
	}
	if name == "" {
		name = cfg.Default
	}
	if _, ok := cfg.Presets[name]; !ok {
		return "", cfg, fmt.Errorf("unknown build preset %q; select an existing preset", name)
	}
	return name, cfg, nil
}
func applyBuildPreset(root string, cfg config, explicit string) (config, error) {
	name, presets, err := activePreset(root, explicit)
	if err != nil {
		return cfg, err
	}
	p, err := resolvePreset(presets, name, map[string]bool{})
	if err != nil {
		return cfg, err
	}
	data, _ := json.Marshal(p)
	hash := sha256.Sum256(data)
	cfg.Build = &p
	cfg.Preset = name
	cfg.Project.BuildDir = filepath.ToSlash(filepath.Join(cfg.Project.BuildDir, name, fmt.Sprintf("%x", hash[:6])))
	return cfg, checkBuildDir(root, cfg.Project.BuildDir)
}
func presetsCommand(root, action, name string) error {
	active, cfg, err := activePreset(root, name)
	selectionError := ""
	if err != nil {
		if action != "presets" {
			return err
		}
		selectionError = err.Error()
		cfg, err = readPresets(root)
		if err != nil {
			return err
		}
	}
	if action == "select-preset" {
		if name == "" {
			return fmt.Errorf("select-preset requires --preset NAME")
		}
		if err := realDir(filepath.Join(root, stateDir)); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(root, stateDir, "build-preset.json"), active); err != nil {
			return err
		}
	}
	names := make([]string, 0, len(cfg.Presets))
	for name := range cfg.Presets {
		names = append(names, name)
	}
	sort.Strings(names)
	return json.NewEncoder(os.Stdout).Encode(presetReport{Active: active, Names: names, SelectionError: selectionError})
}

// Load the generated Makefile first, then append flags without replacing its
// CPU, include, dependency, linker-script or per-target settings.
func presetMakeArgs(root string, cfg config) ([]string, func(), error) {
	if cfg.Build == nil {
		return []string{"DEBUG=1", "OPT=-Og"}, func() {}, nil
	}
	p := cfg.Build
	debug := "0"
	if *p.Debug {
		debug = "1"
	}
	args := []string{"DEBUG=" + debug, "OPT=" + p.Optimization, "BUILD_DIR=" + cfg.Project.BuildDir}
	var content strings.Builder
	for _, item := range []struct {
		name  string
		flags []string
	}{
		{"CFLAGS", append(append([]string{}, p.BuildFlags...), p.CFlags...)},
		{"CXXFLAGS", append(append([]string{}, p.BuildFlags...), p.CXXFlags...)},
		{"ASFLAGS", p.ASFlags}, {"LDFLAGS", p.LDFlags},
	} {
		if len(item.flags) > 0 {
			fmt.Fprintf(&content, "override %s += %s\n", item.name, strings.Join(item.flags, " "))
		}
	}
	if content.Len() == 0 {
		return args, func() {}, nil
	}
	dir := filepath.Join(root, stateDir)
	if err := realDir(dir); err != nil {
		return nil, nil, err
	}
	f, err := os.CreateTemp(dir, ".preset-*.mk")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { os.Remove(f.Name()) }
	_, err = f.WriteString(content.String())
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return append(args, "-f", "Makefile", "-f", f.Name()), cleanup, nil
}
