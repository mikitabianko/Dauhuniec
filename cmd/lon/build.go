package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func build(root string, cfg config, execute runner) error {
	if runtime.GOOS == "windows" {
		// CubeMX's mkdir recipe uses Unix flags. Create its target ourselves so
		// Make never needs that recipe, including after Clean or regeneration.
		if err := checkBuildDir(root, cfg.Project.BuildDir); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(root, cfg.Project.BuildDir), 0755); err != nil {
			return err
		}
	}
	environment := buildEnvironment(cfg)
	command := []string{cfg.Tools["make"], "-j2", "GCC_PATH=", "PREFIX=arm-none-eabi-", "DEBUG=1", "OPT=-Og", "all"}
	if runtime.GOOS == "windows" {
		command = append(command, "SHELL=cmd.exe", ".SHELLFLAGS=/c")
	}
	return execute(root, command, environment)
}

func buildEnvironment(cfg config) []string {
	path := strings.Join([]string{filepath.Dir(cfg.Tools["gcc"]), filepath.Dir(cfg.Tools["make"]), os.Getenv("PATH")}, string(os.PathListSeparator))
	var environment []string
	for _, variable := range os.Environ() {
		key, _, _ := strings.Cut(variable, "=")
		switch strings.ToUpper(key) {
		case "PATH":
			continue
		case "MAKESHELL", "SHELL":
			if runtime.GOOS == "windows" {
				continue
			}
		}
		environment = append(environment, variable)
	}
	environment = append(environment, "PATH="+path)
	if runtime.GOOS == "windows" {
		environment = append(environment, "MAKESHELL=cmd.exe")
	}
	return environment
}
