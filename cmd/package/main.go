// Build the six native CLI executables and their checksums, without archives.
package main

import (
	"crypto/sha256"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
)

func main() {
	jobs := flag.Int("jobs", 1, "maximum number of concurrent target builds")
	flag.Parse()
	if err := release(*jobs); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type target struct{ os, arch string }

func release(jobs int) error {
	if jobs < 1 {
		return fmt.Errorf("jobs must be at least 1")
	}
	if _, err := os.Stat("go.mod"); err != nil {
		return fmt.Errorf("run from the module root: %w", err)
	}
	if err := os.MkdirAll("bin", 0755); err != nil {
		return err
	}
	targets := []target{
		{"darwin", "amd64"}, {"darwin", "arm64"},
		{"linux", "amd64"}, {"linux", "arm64"},
		{"windows", "amd64"}, {"windows", "arm64"},
	}
	lines, err := buildTargets(targets, jobs, buildTarget)
	if err != nil {
		return err
	}
	if err := os.WriteFile("SHA256SUMS", []byte(strings.Join(lines, "")), 0644); err != nil {
		return err
	}
	fmt.Println("Ready: bin/ and SHA256SUMS")
	return nil
}

// Keep workers busy as targets finish, but retain the manifest's target order.
func buildTargets(targets []target, jobs int, build func(target) (string, error)) ([]string, error) {
	if jobs < 1 {
		return nil, fmt.Errorf("jobs must be at least 1")
	}
	if jobs > len(targets) {
		jobs = len(targets)
	}
	lines := make([]string, len(targets))
	errs := make([]error, len(targets))
	queue := make(chan int)
	var workers sync.WaitGroup
	for worker := 0; worker < jobs; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for i := range queue {
				lines[i], errs[i] = build(targets[i])
			}
		}()
	}
	for i := range targets {
		queue <- i
	}
	close(queue)
	workers.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return lines, nil
}

func buildTarget(target target) (string, error) {
	name := "bin/lon-" + target.os + "-" + target.arch
	if target.os == "windows" {
		name += ".exe"
	}
	fmt.Println("Building", name)
	cmd := exec.Command("go", "build", "-trimpath", "-ldflags=-s -w", "-o", name, "./cmd/lon")
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "GOOS", "GOARCH", "CGO_ENABLED":
		default:
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GOOS="+target.os, "GOARCH="+target.arch, "CGO_ENABLED=0")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("build %s: %w", name, err)
	}
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	_, hashErr := io.Copy(hash, file)
	closeErr := file.Close()
	if hashErr != nil {
		return "", hashErr
	}
	if closeErr != nil {
		return "", closeErr
	}
	return fmt.Sprintf("%x  %s\n", hash.Sum(nil), name), nil
}
