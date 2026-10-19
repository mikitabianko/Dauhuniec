// Build the six native CLI executables and their checksums, without archives.
package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

func main() {
	if err := release(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func release() error {
	if _, err := os.Stat("go.mod"); err != nil {
		return fmt.Errorf("run from the module root: %w", err)
	}
	if err := os.MkdirAll("bin", 0755); err != nil {
		return err
	}
	var checksums strings.Builder
	for _, target := range []struct{ os, arch string }{
		{"darwin", "amd64"}, {"darwin", "arm64"},
		{"linux", "amd64"}, {"linux", "arm64"},
		{"windows", "amd64"}, {"windows", "arm64"},
	} {
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
			return err
		}
		file, err := os.Open(name)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, hashErr := io.Copy(hash, file)
		closeErr := file.Close()
		if hashErr != nil {
			return hashErr
		}
		if closeErr != nil {
			return closeErr
		}
		fmt.Fprintf(&checksums, "%x  %s\n", hash.Sum(nil), name)
	}
	if err := os.WriteFile("SHA256SUMS", []byte(checksums.String()), 0644); err != nil {
		return err
	}
	fmt.Println("Ready: bin/ and SHA256SUMS")
	return nil
}
