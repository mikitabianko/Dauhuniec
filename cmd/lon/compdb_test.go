package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestCompilationDatabaseExpandsMakeAndPreservesPreviousOnFailure(t *testing.T) {
	makePath, err := exec.LookPath("make")
	if err != nil {
		t.Skip("Make unavailable")
	}
	root := filepath.Join(t.TempDir(), "project ü [test] Кириллица")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	write := func(name, data string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("main.c", "#include <stddef.h>\nint main(void) { return 0; }\n")
	write("extra.c", "int extra(void) { return 42; }\n")
	write("flags.mk", "CPPFLAGS = -DVALUE=42 -I\"include dir\"\n")
	write("Makefile", `include flags.mk
SOURCES = $(wildcard *.c)
.PHONY: all
all: $(SOURCES:.c=.o)
extra.o: CPPFLAGS += -DEXTRA=1
%.o: %.c
	$(CC) $(CPPFLAGS) -mcpu=cortex-m4 -mthumb -std=gnu11 -c $< -o $@
`)
	gcc := filepath.Join(root, "toolchain with spaces", "arm-none-eabi-gcc")
	cfg := config{Tools: map[string]string{"make": makePath, "gcc": gcc}}
	if err := generateCompilationDatabase(root, cfg); err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(root, stateDir, "compile_commands.json")
	data, err := os.ReadFile(database)
	if err != nil {
		t.Fatal(err)
	}
	var commands []compileCommand
	if err := json.Unmarshal(data, &commands); err != nil {
		t.Fatal(err)
	}
	if len(commands) != 2 {
		t.Fatalf("missing translation units: %+v", commands)
	}
	for _, c := range commands {
		if c.Directory != root || c.Arguments[0] != gcc || !filepath.IsAbs(c.File) {
			t.Fatalf("wrong paths: %+v", c)
		}
		args := strings.Join(c.Arguments, "\n")
		if !strings.Contains(args, "-Iinclude dir\n") || !strings.Contains(args, "-DVALUE=42\n") {
			t.Fatalf("lost flags: %v", c.Arguments)
		}
		if strings.HasSuffix(c.File, "extra.c") && !strings.Contains(args, "-DEXTRA=1\n") {
			t.Fatal("lost per-file flags")
		}
	}
	if _, err := os.Stat(filepath.Join(root, "main.o")); !os.IsNotExist(err) {
		t.Fatal("dry run compiled source")
	}
	ignore, err := os.ReadFile(filepath.Join(root, stateDir, ".gitignore"))
	if err != nil || !strings.Contains(string(ignore), "compile_commands.json\n") || !strings.Contains(string(ignore), ".cache/\n") {
		t.Fatalf("local index files not ignored: %q, %v", ignore, err)
	}
	before, _ := os.Stat(database)
	if err := generateCompilationDatabase(root, cfg); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(database)
	if !os.SameFile(before, after) {
		t.Fatal("unchanged database rewritten")
	}
	write("flags.mk", "CPPFLAGS = -DVALUE=99\n")
	if err := generateCompilationDatabase(root, cfg); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(database)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(updated), "-DVALUE=99") {
		t.Fatal("Make flags not refreshed")
	}
	write("Makefile", "all:\n\t$(CC) 'unclosed -c main.c\n")
	if err := generateCompilationDatabase(root, cfg); err == nil {
		t.Fatal("malformed recipe accepted")
	}
	retained, err := os.ReadFile(database)
	if err != nil || string(retained) != string(updated) {
		t.Fatal("failed refresh damaged database")
	}
}

func TestCompilationRecipeTokenization(t *testing.T) {
	for _, tc := range []struct {
		line    string
		windows bool
		want    []string
	}{
		{`dauhuniec-cc -DNAME='"hello world"' -I"dir with spaces" -c source\ file.c`, false, []string{"dauhuniec-cc", `-DNAME="hello world"`, "-Idir with spaces", "-c", "source file.c"}},
		{`dauhuniec-cc -I"C:\SDK Files\Inc" -c "Core\Src\main.c"`, true, []string{"dauhuniec-cc", `-IC:\SDK Files\Inc`, "-c", `Core\Src\main.c`}},
	} {
		got, err := splitCompileCommand(tc.line, tc.windows)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: %q, %v", tc.line, got, err)
		}
	}
	for _, line := range []string{`dauhuniec-cc -c main.c && echo done`, `dauhuniec-cc "unclosed`} {
		if _, err := splitCompileCommand(line, false); err == nil {
			t.Fatalf("accepted unsupported recipe: %s", line)
		}
	}
	root := t.TempDir()
	gxx := filepath.Join(root, "arm-none-eabi-g++")
	gcc := filepath.Join(root, "arm-none-eabi-gcc")
	if runtime.GOOS == "windows" {
		gxx += ".exe"
		gcc += ".exe"
	}
	if err := os.WriteFile(gxx, nil, 0755); err != nil {
		t.Fatal(err)
	}
	commands, err := parseCompileCommands(root, gcc, "echo noise\ndauhuniec-cc -c startup.s\ndauhuniec-cxx -std=gnu++17 -c main.cpp -o main.o\n", runtime.GOOS == "windows")
	if err != nil || len(commands) != 1 || commands[0].Arguments[0] != gxx {
		t.Fatalf("C++ database: %+v %v", commands, err)
	}
}
