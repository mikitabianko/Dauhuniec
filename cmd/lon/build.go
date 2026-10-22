package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func build(root string, cfg config, execute runner) error {
	// CubeMX may emit plain mkdir, which cannot create nested preset paths.
	// Create the complete output path on every platform, also after Clean.
	if err := checkBuildDir(root, cfg.Project.BuildDir); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(root, cfg.Project.BuildDir), 0755); err != nil {
		return err
	}
	args, cleanup, err := presetMakeArgs(root, cfg)
	if err != nil {
		return err
	}
	defer cleanup()
	environment := buildEnvironment(cfg)
	command := []string{cfg.Tools["make"], "-j2", "GCC_PATH=", "PREFIX=arm-none-eabi-"}
	command = append(command, args...)
	command = append(command, "all")
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
