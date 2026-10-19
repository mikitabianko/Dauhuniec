package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type probe struct {
	Serial   string `json:"serial"`
	Name     string `json:"name,omitempty"`
	Firmware string `json:"firmware,omitempty"`
}

type probeReport struct {
	SchemaVersion  int     `json:"schemaVersion"`
	Probes         []probe `json:"probes"`
	Selected       *probe  `json:"selected,omitempty"`
	SelectionError string  `json:"selectionError,omitempty"`
}

var probeSerialPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var probeANSI = regexp.MustCompile("\x1b\\[[0-?]*[ -/]*[@-~]")
var probeHeader = regexp.MustCompile(`(?i)^ST-?Link Probe\s+\d+\s*:?\s*$`)

func parseProbes(text string) ([]probe, error) {
	text = probeANSI.ReplaceAllString(text, "")
	result := []probe{}
	var current probe
	flush := func() {
		if current.Serial != "" {
			result = append(result, current)
		}
		current = probe{}
	}
	headerSeen := false
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if probeHeader.MatchString(line) {
			flush()
			headerSeen = true
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "st-link sn", "stlink sn":
			if !probeSerialPattern.MatchString(value) {
				return nil, errors.New("invalid ST-LINK serial in probe listing")
			}
			if current.Serial != "" {
				flush()
			}
			current.Serial = strings.ToUpper(value)
		case "board", "board name":
			current.Name = value
		case "st-link fw", "stlink fw":
			current.Firmware = value
		}
	}
	flush()
	if len(result) == 0 && (headerSeen || !strings.Contains(strings.ToLower(text), "no st-link detected")) {
		return nil, errors.New("could not read the ST-LINK probe list; run List ST-LINK Probes to inspect CubeProgrammer output")
	}
	return result, nil
}

func listProbes(root string, cfg config) ([]probe, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, cfg.Tools["programmer"], "-l", "st-link-only")
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("list ST-LINK probes: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return parseProbes(string(output))
}

func readSelectedProbe(root string) (*probe, error) {
	data, err := os.ReadFile(filepath.Join(root, stateDir, "target.json"))
	if os.IsNotExist(err) {
		data, err = os.ReadFile(filepath.Join(root, previousStateDir, "target.json"))
	}
	if os.IsNotExist(err) {
		data, err = os.ReadFile(filepath.Join(root, legacyStateDir, "target.json"))
	}
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var selected probe
	if err := json.Unmarshal(data, &selected); err != nil {
		return nil, fmt.Errorf("read saved target: %w", err)
	}
	if !probeSerialPattern.MatchString(selected.Serial) {
		return nil, errors.New("invalid saved target; choose Target Board again")
	}
	selected.Serial = strings.ToUpper(selected.Serial)
	return &selected, nil
}

func saveSelectedProbe(root string, selected probe) error {
	if !probeSerialPattern.MatchString(selected.Serial) {
		return errors.New("invalid ST-LINK serial number")
	}
	dir := filepath.Join(root, stateDir)
	if err := realDir(dir); err != nil {
		return err
	}
	ignorePath := filepath.Join(dir, ".gitignore")
	ignore, err := os.ReadFile(ignorePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	ignored := false
	for _, line := range strings.Split(string(ignore), "\n") {
		if strings.TrimSpace(line) == "target.json" {
			ignored = true
		}
	}
	if !ignored {
		if len(ignore) > 0 && ignore[len(ignore)-1] != '\n' {
			ignore = append(ignore, '\n')
		}
		if err := os.WriteFile(ignorePath, append(ignore, []byte("target.json\n")...), 0644); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(selected, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".target-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(append(data, '\n')); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, "target.json"))
}

func chooseProbe(probes []probe, saved *probe, explicit string) (probe, error) {
	serial := strings.ToUpper(explicit)
	if serial == "" && saved != nil {
		serial = saved.Serial
	}
	if serial == "" {
		switch len(probes) {
		case 0:
			return probe{}, errors.New("no ST-LINK connected")
		case 1:
			return probes[0], nil
		default:
			return probe{}, errors.New("multiple boards connected; choose the exact Target Board in Dauhuniec before flashing")
		}
	}
	var matches []probe
	for _, item := range probes {
		if strings.EqualFold(item.Serial, serial) {
			matches = append(matches, item)
		}
	}
	if len(matches) == 0 {
		return probe{}, fmt.Errorf("selected ST-LINK %s is disconnected; reconnect it or explicitly choose another Target Board", serial)
	}
	if len(matches) > 1 {
		return probe{}, fmt.Errorf("multiple ST-LINKs report serial %s; cannot identify the selected device uniquely", serial)
	}
	return matches[0], nil
}

func requireProbe(root string, cfg config, explicit string) (probe, error) {
	probes, err := listProbes(root, cfg)
	if err != nil {
		return probe{}, err
	}
	saved, err := readSelectedProbe(root)
	if err != nil {
		return probe{}, err
	}
	selected, err := chooseProbe(probes, saved, explicit)
	if err != nil {
		return probe{}, err
	}
	if saved == nil && explicit == "" {
		err = saveSelectedProbe(root, selected)
	}
	return selected, err
}
