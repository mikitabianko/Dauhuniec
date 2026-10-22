package main

import (
	"bytes"
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

type compileCommand struct {
	Directory string   `json:"directory"`
	File      string   `json:"file"`
	Arguments []string `json:"arguments"`
}

// Ask Make to expand the real recipes, including per-file flags and wildcards.
// Compiler markers avoid shell quoting of machine-specific executable paths.
func generateCompilationDatabase(root string, cfg config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	args := []string{"--no-print-directory", "-n", "-B", "GCC_PATH=", "PREFIX=arm-none-eabi-", "DEBUG=1", "OPT=-Og", "CC=dauhuniec-cc", "CXX=dauhuniec-cxx", "all"}
	if runtime.GOOS == "windows" {
		args = append(args, "SHELL=cmd.exe", ".SHELLFLAGS=/c")
	}
	cmd := exec.CommandContext(ctx, cfg.Tools["make"], args...)
	cmd.Dir, cmd.Env = root, buildEnvironment(cfg)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("generate compile_commands.json: Make dry run: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	commands, err := parseCompileCommands(root, cfg.Tools["gcc"], string(output), runtime.GOOS == "windows")
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(commands, "", "  ")
	if err != nil {
		return err
	}
	return writeCompilationDatabase(root, append(data, '\n'))
}

func parseCompileCommands(root, gcc, output string, windows bool) ([]compileCommand, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	var commands []compileCommand
	output = strings.ReplaceAll(output, "\r\n", "\n")
	for _, line := range strings.Split(strings.ReplaceAll(output, "\\\n", " "), "\n") {
		line = strings.TrimSpace(line)
		// Do not interpret echo, linker, assembly, directory or recursive-make output.
		compilerWord := strings.Fields(line)
		if len(compilerWord) == 0 || (compilerWord[0] != "dauhuniec-cc" && compilerWord[0] != "dauhuniec-cxx") {
			continue
		}
		args, err := splitCompileCommand(line, windows)
		if err != nil {
			return nil, fmt.Errorf("parse Make compiler recipe: %w", err)
		}
		compile, source := false, ""
		for _, arg := range args[1:] {
			if arg == "-c" {
				compile = true
			}
			if strings.HasPrefix(arg, "-") {
				continue
			}
			switch filepath.Ext(arg) {
			case ".c", ".C", ".cc", ".cpp", ".cxx":
				if source != "" {
					return nil, fmt.Errorf("multiple source files in Make recipe: %s", line)
				}
				source = arg
			}
		}
		if !compile || source == "" {
			continue
		}
		compiler := gcc
		if args[0] == "dauhuniec-cxx" {
			compiler = strings.TrimSuffix(strings.TrimSuffix(gcc, ".exe"), "gcc") + "g++"
			if windows {
				compiler += ".exe"
			}
			if !regularFile(compiler) {
				return nil, fmt.Errorf("C++ compiler not found: %s", compiler)
			}
		}
		args[0] = compiler
		file := source
		if !filepath.IsAbs(file) {
			file = filepath.Join(root, file)
		}
		commands = append(commands, compileCommand{root, filepath.Clean(file), args})
	}
	if len(commands) == 0 {
		return nil, fmt.Errorf("no C/C++ compiler recipes found for compile_commands.json; expected CubeMX Makefile recipes using $(CC) or $(CXX)")
	}
	return commands, nil
}

// Tokenize a compiler recipe, never execute it. Preserve Windows path separators.
func splitCompileCommand(line string, windows bool) ([]string, error) {
	var result []string
	var word strings.Builder
	var quote byte
	started := false
	flush := func() {
		if started {
			result = append(result, word.String())
			word.Reset()
			started = false
		}
	}
	for i := 0; i < len(line); i++ {
		c := line[i]
		if c == '\\' && quote != '\'' {
			if i+1 < len(line) && (!windows || line[i+1] == '"') {
				i++
				word.WriteByte(line[i])
				started = true
				continue
			}
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				word.WriteByte(c)
			}
			started = true
			continue
		}
		switch c {
		case '\'', '"':
			quote = c
			started = true
		case ' ', '\t', '\r':
			flush()
		case ';', '|', '&', '<', '>':
			return nil, fmt.Errorf("compound compiler recipes are unsupported: %s", line)
		default:
			word.WriteByte(c)
			started = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("unclosed quote in %s", line)
	}
	flush()
	return result, nil
}

func writeCompilationDatabase(root string, data []byte) error {
	dir := filepath.Join(root, stateDir)
	if err := realDir(dir); err != nil {
		return err
	}
	if err := ignoreCompilationFiles(dir); err != nil {
		return err
	}
	destination := filepath.Join(dir, "compile_commands.json")
	previous, err := os.ReadFile(destination)
	if err == nil && bytes.Equal(previous, data) {
		return nil
	}
	file, err := os.CreateTemp(dir, ".compile-commands-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Chmod(file.Name(), 0644); err != nil {
		return err
	}
	return os.Rename(file.Name(), destination)
}

// Existing projects may not yet have setup's root .gitignore block.
func ignoreCompilationFiles(dir string) error {
	path := filepath.Join(dir, ".gitignore")
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return fmt.Errorf("expected a regular ignore file: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	var missing []string
	for _, rule := range []string{"compile_commands.json", ".cache/"} {
		found := false
		for _, line := range strings.Split(string(data), "\n") {
			if strings.TrimPrefix(strings.TrimSuffix(line, "\r"), "/") == rule {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, rule)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	newline := "\n"
	if bytes.Contains(data, []byte("\r\n")) {
		newline = "\r\n"
	}
	addition := strings.Join(missing, newline) + newline
	if len(data) > 0 && data[len(data)-1] != '\n' {
		addition = newline + addition
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString(addition)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	return closeErr
}
