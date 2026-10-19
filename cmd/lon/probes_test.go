package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const twoProbeListing = "\x1b[32m===== STLink Interface =====\x1b[0m\r\nST-Link Probe 0:\r\nST-LINK SN : AAAAAAAA\r\nST-LINK FW : V3J17\r\nBoard Name : NUCLEO-C071RB\r\nST-Link Probe 1:\r\nST-LINK SN : BBBBBBBB\r\nST-LINK FW : V3J17\r\nBoard Name : NUCLEO-C071RB\r\n"

func TestProbeParsingAndIdentity(t *testing.T) {
	probes, err := parseProbes(twoProbeListing)
	if err != nil || len(probes) != 2 || probes[0].Name != probes[1].Name || probes[0].Serial != "AAAAAAAA" || probes[1].Serial != "BBBBBBBB" {
		t.Fatalf("%+v, %v", probes, err)
	}
	if _, err := chooseProbe(probes, nil, ""); err == nil {
		t.Fatal("ambiguous initial choice accepted")
	}
	saved := probes[0]
	chosen, err := chooseProbe([]probe{probes[1], probes[0]}, &saved, "")
	if err != nil || chosen.Serial != saved.Serial {
		t.Fatal("new connection/order changed target", chosen, err)
	}
	if _, err := chooseProbe(probes[1:], &saved, ""); err == nil || !strings.Contains(err.Error(), "disconnected") {
		t.Fatal("silently switched away from absent target", err)
	}
	if _, err := chooseProbe([]probe{saved, saved}, &saved, ""); err == nil {
		t.Fatal("duplicate serial accepted")
	}
	if none, err := parseProbes("No ST-Link detected!"); err != nil || len(none) != 0 {
		t.Fatal(none, err)
	}
	for _, text := range []string{"unexpected output", "ST-Link Probe 0:\nST-LINK SN : bad serial", "ST-Link Probe 0:\n"} {
		if _, err := parseProbes(text); err == nil {
			t.Fatal("accepted malformed listing", text)
		}
	}
}

func TestSavedTargetSurvivesReloadAndExplicitChange(t *testing.T) {
	root := t.TempDir()
	if selected, err := readSelectedProbe(root); err != nil || selected != nil {
		t.Fatal(selected, err)
	}
	for _, serial := range []string{"AAAAAAAA", "BBBBBBBB"} {
		if err := saveSelectedProbe(root, probe{Serial: serial, Name: "Same board"}); err != nil {
			t.Fatal(err)
		}
		selected, err := readSelectedProbe(root)
		if err != nil || selected.Serial != serial {
			t.Fatal(selected, err)
		}
	}
	ignore, _ := os.ReadFile(filepath.Join(root, stateDir, ".gitignore"))
	if !strings.Contains(string(ignore), "target.json") {
		t.Fatal("selection must stay machine-local")
	}
	if err := os.WriteFile(filepath.Join(root, stateDir, "target.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSelectedProbe(root); err == nil {
		t.Fatal("corrupt saved target treated as no choice")
	}
}

func TestDispatchNeverFlashesAnUnselectedOrDisconnectedBoard(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix executable fixture; selection logic is portable")
	}
	root := fixture(t)
	p, err := readProject(root)
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(root, stateDir)
	os.Mkdir(state, 0755)
	listing := filepath.Join(root, "probes.txt")
	trace := filepath.Join(root, "programmer-argv.txt")
	t.Setenv("DAUHUNIEC_TEST_PROBES", listing)
	t.Setenv("DAUHUNIEC_TEST_COMMAND", trace)
	programmer := filepath.Join(root, "programmer")
	script := "#!/bin/sh\nif [ \"$1\" = \"-l\" ]; then\n  cat \"$DAUHUNIEC_TEST_PROBES\"\nelse\n  printf '%s\\n' \"$@\" > \"$DAUHUNIEC_TEST_COMMAND\"\nfi\n"
	os.WriteFile(programmer, []byte(script), 0755)
	tools := map[string]string{}
	for _, key := range []string{"gcc", "gdb", "objcopy", "objdump", "nm", "size", "server", "programmer", "make"} {
		tools[key] = programmer
	}
	data, _ := json.Marshal(config{Project: p, Tools: tools})
	os.WriteFile(filepath.Join(state, "tools.json"), data, 0644)
	os.MkdirAll(filepath.Dir(elfPath(root, p)), 0755)
	os.WriteFile(elfPath(root, p), []byte("ELF"), 0644)
	os.WriteFile(listing, []byte(twoProbeListing), 0644)
	if err := dispatch([]string{"upload", "--project", root}); err == nil {
		t.Fatal("flashed before selecting between identical boards")
	}
	if _, err := os.Stat(trace); !os.IsNotExist(err) {
		t.Fatal("programmer was invoked before selection")
	}
	if err := dispatch([]string{"select-probe", "--project", root, "--probe-serial", "AAAAAAAA"}); err != nil {
		t.Fatal(err)
	}
	if err := dispatch([]string{"upload", "--project", root}); err != nil {
		t.Fatal(err)
	}
	command, _ := os.ReadFile(trace)
	if !strings.Contains(string(command), "sn=AAAAAAAA\n") || strings.Contains(string(command), "BBBBBBBB") {
		t.Fatal(string(command))
	}
	os.Remove(trace)
	os.WriteFile(listing, []byte("ST-Link Probe 0:\nST-LINK SN : BBBBBBBB\nBoard Name : NUCLEO-C071RB\n"), 0644)
	if err := dispatch([]string{"upload", "--project", root}); err == nil {
		t.Fatal("flashed remaining board when selected board disconnected")
	}
	if _, err := os.Stat(trace); !os.IsNotExist(err) {
		t.Fatal("unexpected programming after target removal")
	}
	selected, err := readSelectedProbe(root)
	if err != nil || selected.Serial != "AAAAAAAA" {
		t.Fatal("lost remembered selection", selected, err)
	}
}
