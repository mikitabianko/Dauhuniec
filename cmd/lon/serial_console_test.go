package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type consoleTestOutput struct {
	mu sync.Mutex
	bytes.Buffer
}

func (b *consoleTestOutput) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.Write(data)
}
func (b *consoleTestOutput) text() string { b.mu.Lock(); defer b.mu.Unlock(); return b.Buffer.String() }
func waitConsole(t *testing.T, output *consoleTestOutput, text string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(output.text(), text) {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("missing %q in %q", text, output.text())
}

func TestConsoleInteractive(t *testing.T) {
	port, device := net.Pipe()
	defer port.Close()
	defer device.Close()
	device.SetDeadline(time.Now().Add(5 * time.Second))
	input, keyboard := io.Pipe()
	defer input.Close()
	defer keyboard.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	output := &consoleTestOutput{}
	done := make(chan error, 1)
	go func() {
		done <- runSerialConsole(ctx, port, input, output, consoleOptions{port: "TEST", baud: 115200, ending: "lf"})
	}()
	waitConsole(t, output, "Logging is off")
	file := filepath.Join(t.TempDir(), "log with spaces.jsonl")
	keyboard.Write([]byte("/log " + file + "\n"))
	waitConsole(t, output, "Logging to "+file)
	keyboard.Write([]byte("/ending crlf\n"))
	waitConsole(t, output, "Line ending: crlf")
	keyboard.Write([]byte("hello\n"))
	sent := make([]byte, 7)
	if _, err := io.ReadFull(device, sent); err != nil || string(sent) != "hello\r\n" {
		t.Fatalf("TX: %q, %v", sent, err)
	}
	received := []byte("Привет\n")
	device.Write(received)
	waitConsole(t, output, "Привет")
	keyboard.Write([]byte("/hex\n"))
	waitConsole(t, output, "HEX display")
	device.Write([]byte{0, 255})
	waitConsole(t, output, "00 FF")
	keyboard.Write([]byte("/logoff\n"))
	waitConsole(t, output, "Logging off")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var directions []string
	var rx []byte
	for _, line := range bytes.Split(bytes.TrimSpace(data), []byte{'\n'}) {
		var record consoleLogRecord
		if err := json.Unmarshal(line, &record); err != nil {
			t.Fatal(err)
		}
		if _, err := time.Parse(time.RFC3339Nano, record.Timestamp); err != nil {
			t.Fatal(err)
		}
		if record.Port != "TEST" || record.Baud != 115200 {
			t.Fatalf("metadata: %+v", record)
		}
		directions = append(directions, record.Direction)
		if record.Direction == "RX" {
			rx = append(rx, record.Data...)
		}
	}
	if len(directions) != 5 || directions[0] != "INFO" || directions[4] != "INFO" || strings.Count(strings.Join(directions, ","), "TX") != 1 || strings.Count(strings.Join(directions, ","), "RX") != 2 {
		t.Fatal(directions)
	}
	if !bytes.Equal(rx, append(received, 0, 255)) {
		t.Fatalf("binary log corrupted: %x", rx)
	}
	keyboard.Write([]byte("/quit\n"))
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("quit did not exit")
	}
}

func TestConsoleInputPreservesAndEditsDraftAcrossReceivedData(t *testing.T) {
	keyboard, keyboardInput := io.Pipe()
	defer keyboardInput.Close()
	submittedInput, submitted := io.Pipe()
	defer submittedInput.Close()
	output := &consoleTestOutput{}
	console := &consoleOutput{w: output, interactive: true}
	inputDone := make(chan error, 1)
	go func() {
		inputDone <- readConsoleInput(keyboard, console, submitted)
	}()

	lineResult := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(submittedInput).ReadString('\n')
		lineResult <- line
	}()
	if _, err := keyboardInput.Write([]byte("draft\x1b[D")); err != nil {
		t.Fatal(err)
	}
	waitConsole(t, output, "> draft")
	if err := console.write([]byte("RX\r\n")); err != nil {
		t.Fatal(err)
	}
	if got := output.text(); !strings.Contains(got, "RX\r\n\r\x1b[2K> draft") {
		t.Fatalf("received data did not redraw the input draft: %q", got)
	}
	if _, err := keyboardInput.Write([]byte("\x7f!\r\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case line := <-lineResult:
		if line != "dra!t\n" {
			t.Fatalf("submitted line: %q", line)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("input line was not submitted")
	}
	if err := keyboardInput.Close(); err != nil {
		t.Fatal(err)
	}
	if err := <-inputDone; err != nil {
		t.Fatal(err)
	}
}

func TestConsoleLoggerAppendAndUTF8(t *testing.T) {
	file := filepath.Join(t.TempDir(), "serial.jsonl")
	logger := &consoleLogger{port: "COM12", baud: 9600, report: func(err error) { t.Errorf("logging: %v", err) }}
	if err := logger.start(file); err != nil {
		t.Fatal(err)
	}
	data := []byte("Привет")
	logger.data("RX", data[:1])
	logger.data("RX", data[1:])
	logger.stop()
	if err := logger.start(file); err != nil {
		t.Fatal(err)
	}
	logger.data("TX", []byte("test\r\n"))
	logger.stop()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(raw), []byte{'\n'})
	if len(lines) != 7 {
		t.Fatalf("append lost records: %d", len(lines))
	}
	var text string
	for _, line := range lines {
		var record consoleLogRecord
		json.Unmarshal(line, &record)
		if record.Direction == "RX" {
			text += record.Text
		}
	}
	if text != "Привет" {
		t.Fatalf("split UTF-8: %q", text)
	}
	if err := logger.start(filepath.Join(t.TempDir(), "missing", "log.jsonl")); err == nil {
		t.Fatal("accepted unavailable path")
	}
}

func TestConsoleHelpAndOptions(t *testing.T) {
	var output bytes.Buffer
	if err := serialConsoleCommand([]string{"--help"}, strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "/log PATH") {
		t.Fatal(output.String())
	}
	for _, args := range [][]string{nil, {"--port", "COM1", "--baud", "0"}, {"--port", "COM1", "--ending", "invalid"}} {
		if err := serialConsoleCommand(args, strings.NewReader(""), io.Discard); err == nil {
			t.Fatal("accepted invalid options", args)
		}
	}
}

func TestConsoleInteractiveHelpStartsEachLineAtLeftEdge(t *testing.T) {
	var output bytes.Buffer
	console := &consoleOutput{w: &output, interactive: true,
		terminalSize: func(int) (int, int, error) { return 40, 12, nil }}
	if err := console.beginInteractive(0); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	console.notice("%s", consoleHelp)
	want := "\r\n[Dauhuniec] " + strings.ReplaceAll(consoleHelp, "\n", "\r\n") + "\r\n"
	if output.String() != want {
		t.Fatalf("help must return to column one on every line: %q", output.String())
	}
}

func TestConsoleCancel(t *testing.T) {
	port, device := net.Pipe()
	defer port.Close()
	defer device.Close()
	input, keyboard := io.Pipe()
	defer input.Close()
	defer keyboard.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := runSerialConsole(ctx, port, input, io.Discard, consoleOptions{port: "TEST", baud: 115200, ending: "lf"}); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleResizeWithoutTraffic(t *testing.T) {
	var output bytes.Buffer
	cols, rows := 20, 8
	console := &consoleOutput{w: &output, interactive: true,
		terminalSize: func(int) (int, int, error) { return cols, rows, nil }}
	if err := console.beginInteractive(0); err != nil {
		t.Fatal(err)
	}
	draft := []byte("abcdefghijklmnop")
	if err := console.setInput(draft, len(draft)); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	cols = 10
	if err := console.resize(); err != nil {
		t.Fatal(err)
	}
	if console.terminalCols != 10 || output.String() != "\x1b[s\x1b[8;1H\x1b[2K> jklmnop\x1b[u" {
		t.Fatalf("width-only resize: %q", output.String())
	}
	if string(console.input) != string(draft) || console.cursor != len(draft) {
		t.Fatal("resize changed the draft")
	}
	output.Reset()
	if err := console.resize(); err != nil || output.Len() != 0 {
		t.Fatalf("unchanged size redraws: %q, %v", output.String(), err)
	}
	cols, rows = 30, 12
	if err := console.resize(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "\x1b[8;1H\x1b[2K\x1b[1;11r") || !strings.Contains(output.String(), "\x1b[12;1H\x1b[2K> "+string(draft)) {
		t.Fatalf("height and width resize: %q", output.String())
	}
	output.Reset()
	cols, rows = 0, 0
	if err := console.resize(); err != nil || output.Len() != 0 {
		t.Fatalf("hidden terminal: %q, %v", output.String(), err)
	}
	cols, rows = 10, 4
	if err := console.resize(); err != nil {
		t.Fatal(err)
	}
	if console.terminalCols != 10 || console.terminalRows != 4 || !strings.Contains(output.String(), "\x1b[4;1H\x1b[2K> jklmnop") {
		t.Fatalf("restore after hidden terminal: %q", output.String())
	}
}

func TestConsoleInputViewport(t *testing.T) {
	for _, tc := range []struct {
		name, input, want      string
		cursor, cols, trailing int
	}{
		{"fits", "draft", "> draft", 5, 20, 0},
		{"end", "abcdefghij", "> ghij", 10, 7, 0},
		{"home", "abcdefghij", "> abcd", 0, 7, 4},
		{"middle", "abcdefghij", "> cdef", 6, 7, 0},
		{"UTF-8", "Привет", "> ивет", len("Привет"), 7, 0},
		{"one column", "draft", "", 5, 1, 0},
		{"two columns", "draft", ">", 5, 2, 0},
		{"three columns", "draft", "> ", 5, 3, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			prompt, draft, trailing := consoleInputViewport([]byte(tc.input), tc.cursor, tc.cols)
			if prompt+string(draft) != tc.want || trailing != tc.trailing {
				t.Fatalf("viewport: %q, trailing %d", prompt+string(draft), trailing)
			}
		})
	}
}

func TestConsoleInteractiveLineEndingsAcrossReads(t *testing.T) {
	for _, interactive := range []bool{false, true} {
		var output bytes.Buffer
		console := &consoleOutput{w: &output, interactive: interactive,
			terminalSize: func(int) (int, int, error) { return 10, 6, nil }}
		if interactive {
			if err := console.beginInteractive(0); err != nil {
				t.Fatal(err)
			}
		}
		chunks := []string{"12345678901234567890\nnext\r", "\nlast\n"}
		for i, chunk := range chunks {
			output.Reset()
			if err := console.write([]byte(chunk)); err != nil {
				t.Fatal(err)
			}
			want := chunk
			if interactive {
				want = []string{"12345678901234567890\r\nnext\r", "\nlast\r\n"}[i]
			}
			if output.String() != want {
				t.Fatalf("interactive=%v, chunk=%d: %q, want %q", interactive, i, output.String(), want)
			}
		}
	}
}

func TestConsoleReceivePreservesAutomaticWrapAcrossReads(t *testing.T) {
	var output bytes.Buffer
	console := &consoleOutput{w: &output, interactive: true,
		terminalSize: func(int) (int, int, error) { return 10, 6, nil }}
	if err := console.beginInteractive(0); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(output.String(), "\x1b[?7h") {
		t.Fatal("automatic wrapping was not enabled")
	}
	output.Reset()
	for _, chunk := range []string{"1234567890", "abcdefghij", "tail"} {
		if err := console.write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	if output.String() != "1234567890abcdefghijtail" {
		t.Fatalf("cursor movement between RX chunks breaks soft wrapping: %q", output.String())
	}
	if err := console.setInput([]byte("draft"), 5); err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err := console.clear(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "\x1b[6;1H\x1b[2K> draft") {
		t.Fatalf("clear did not restore the input row: %q", output.String())
	}
}
