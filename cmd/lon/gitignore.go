package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const gitignoreBegin = "# BEGIN Dauhuniec (managed by lon setup)"
const gitignoreEnd = "# END Dauhuniec"

func createProjectGitignore(root string, p project) error {
	if err := checkBuildDir(root, p.BuildDir); err != nil {
		return err
	}
	path := filepath.Join(root, ".gitignore")
	mode := os.FileMode(0644)
	var original []byte
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("expected a regular .gitignore file: %s", path)
		}
		mode = info.Mode().Perm()
		original, err = os.ReadFile(path)
		if err != nil {
			return err
		}
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	updated, err := projectGitignore(original, p)
	if err != nil {
		return fmt.Errorf("update %s: %w", path, err)
	}
	if bytes.Equal(original, updated) {
		return nil
	}
	// Replace only after a successful write; a failed setup must not truncate rules.
	file, err := os.CreateTemp(root, ".gitignore-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(updated)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Chmod(file.Name(), mode); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func projectGitignore(original []byte, p project) ([]byte, error) {
	text := strings.TrimPrefix(string(original), "\ufeff")
	bom := string(original[:len(original)-len(text)])
	newline := "\n"
	if i := strings.IndexByte(text, '\n'); i > 0 && text[i-1] == '\r' {
		newline = "\r\n"
	}
	start, end, offset := -1, -1, 0
	for _, line := range strings.SplitAfter(text, "\n") {
		switch strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r") {
		case gitignoreBegin:
			if start != -1 || end != -1 {
				return nil, errors.New("duplicate or nested Dauhuniec .gitignore markers; repair the managed block first")
			}
			start = offset
		case gitignoreEnd:
			if start == -1 || end != -1 {
				return nil, errors.New("unmatched Dauhuniec .gitignore marker; repair the managed block first")
			}
			end = offset + len(line)
		}
		offset += len(line)
	}
	if start != -1 && end == -1 {
		return nil, errors.New("unclosed Dauhuniec .gitignore block; repair the managed block first")
	}
	block := fmt.Sprintf(`%s
# Build output (Makefile BUILD_DIR)
/%s/

# Local tools, paths, probe selection and editor settings
/%s/
/%s/
/%s/
/.vscode/

# Serial console recordings and logs
serial*.jsonl
*.log

# Operating system files
.DS_Store
._*
Thumbs.db
Desktop.ini
%s
`, gitignoreBegin, filepath.ToSlash(filepath.Clean(p.BuildDir)), stateDir, previousStateDir, legacyStateDir, gitignoreEnd)
	block = strings.ReplaceAll(block, "\n", newline)
	if start == -1 {
		// Later user rules (especially ! exceptions) retain their precedence.
		return []byte(bom + block + text), nil
	}
	return []byte(bom + text[:start] + block + text[end:]), nil
}
