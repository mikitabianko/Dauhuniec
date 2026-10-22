package main

// Discovery never executes an installer or searches outside the supplied roots,
// known ST layouts and PATH. Paths from users are always literal filesystem names.
import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

type toolHost struct {
	OS, Arch, Home string
	Env            map[string]string
	Roots          []string
}
type fileValidation struct {
	Tool     string `json:"tool"`
	Original string `json:"originalPath"`
	Resolved string `json:"resolvedPath,omitempty"`
	Valid    bool   `json:"valid"`
	Reason   string `json:"reason"`
}
type toolCandidate struct {
	Files        []fileValidation  `json:"validation,omitempty"`
	Kind         string            `json:"kind"`
	Original     string            `json:"originalPath"`
	Resolved     string            `json:"resolvedPath,omitempty"`
	Source       string            `json:"source"`
	Installation string            `json:"installation,omitempty"`
	Version      string            `json:"version,omitempty"`
	Valid        bool              `json:"valid"`
	Reason       string            `json:"reason"`
	Components   map[string]string `json:"components,omitempty"`
}
type toolsReport struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Version       string                       `json:"version"`
	Tools         map[string]string            `json:"tools"`
	Checks        []check                      `json:"checks"`
	Details       map[string]toolCandidate     `json:"details"`
	Alternatives  map[string][]toolCandidate   `json:"alternatives"`
	Actions       map[string]map[string]string `json:"actions"`
	Candidates    []toolCandidate              `json:"candidates,omitempty"`
	Selection     map[string]string            `json:"selection,omitempty"`
}

var ideComponents = []struct{ key, family, binary string }{
	{"gcc", "gnu-tools-for-stm32", "arm-none-eabi-gcc"}, {"gdb", "gnu-tools-for-stm32", "arm-none-eabi-gdb"},
	{"objcopy", "gnu-tools-for-stm32", "arm-none-eabi-objcopy"}, {"objdump", "gnu-tools-for-stm32", "arm-none-eabi-objdump"},
	{"nm", "gnu-tools-for-stm32", "arm-none-eabi-nm"}, {"size", "gnu-tools-for-stm32", "arm-none-eabi-size"},
	{"server", "stlink-gdb-server", "ST-LINK_gdbserver"}, {"programmer", "cubeprogrammer", "STM32_Programmer_CLI"}, {"make", "make", "make"},
}
var actionRequirements = map[string][]string{
	"build": {"gcc", "objcopy", "size", "make"}, "flash": {"programmer"}, "debug": {"gdb", "objdump", "nm", "server", "programmer"},
	"setup": {"gcc", "gdb", "objcopy", "objdump", "nm", "size", "server", "programmer", "make"}, "cubeMX": {"cubeMX"},
}

func currentToolHost() toolHost {
	home, _ := os.UserHomeDir()
	env := map[string]string{}
	for _, entry := range os.Environ() {
		k, v, ok := strings.Cut(entry, "=")
		if ok {
			env[k] = v
		}
	}
	return toolHost{OS: runtime.GOOS, Arch: runtime.GOARCH, Home: home, Env: env}
}
func (h toolHost) env(key string) string {
	for k, v := range h.Env {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}
func (h toolHost) inputPath(value string) string {
	if h.OS != "windows" {
		return value
	}
	value = strings.Trim(strings.TrimSpace(value), "\"")
	for key, replacement := range h.Env {
		token := "%" + key + "%"
		for {
			lower := strings.ToLower(value)
			i := strings.Index(lower, strings.ToLower(token))
			if i < 0 {
				break
			}
			value = value[:i] + replacement + value[i+len(token):]
			if strings.Contains(strings.ToLower(replacement), strings.ToLower(token)) {
				break
			}
		}
	}
	return value
}
func (h toolHost) suffix() string {
	if h.OS == "windows" {
		return ".exe"
	}
	return ""
}
func (h toolHost) roots() []string {
	if h.Roots != nil {
		return h.Roots
	}
	roots := []string{filepath.Join(h.Home, "STMicroelectronics"), filepath.Join(h.Home, "STM32Cube"), filepath.Join(h.Home, "st"), filepath.Join(h.Home, "STM32CubeMX")}
	switch h.OS {
	case "darwin":
		roots = append(roots, "/Applications", filepath.Join(h.Home, "Applications"))
	case "windows":
		for _, key := range []string{"ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"} {
			if base := h.env(key); base != "" {
				roots = append(roots, filepath.Join(base, "STMicroelectronics"), filepath.Join(base, "Programs", "STMicroelectronics"), filepath.Join(base, "Programs", "STM32CubeMX"))
			}
		}
		if drive := h.env("SystemDrive"); drive != "" {
			roots = append(roots, filepath.Join(drive+string(filepath.Separator), "ST"))
		}
	case "linux":
		roots = append(roots, "/opt", "/usr/local")
	}
	return unique(roots)
}
func children(root string, match func(string) bool) []string {
	entries, _ := os.ReadDir(root)
	var out []string
	for _, entry := range entries {
		if match(entry.Name()) {
			out = append(out, filepath.Join(root, entry.Name()))
		}
	}
	return out
}
func executablePath(path, goos string) (string, error) {
	resolved, err := canonical(path)
	if err != nil {
		return "", fmt.Errorf("missing path, broken symbolic link or link cycle: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("not a regular file")
	}
	if goos != "windows" && info.Mode().Perm()&0111 == 0 {
		return "", fmt.Errorf("file has no execution permission")
	}
	return resolved, nil
}
func pluginDirectory(root string) (string, error) {
	resolved, err := canonical(root)
	if err != nil {
		return "", fmt.Errorf("missing installation, broken symbolic link or link cycle: %w", err)
	}
	root = resolved

	for _, suffix := range []string{"", "plugins", "STM32CubeIDE/plugins", "Contents/Eclipse/plugins", "STM32CubeIDE.app/Contents/Eclipse/plugins"} {
		candidate := filepath.Join(root, filepath.FromSlash(suffix))
		if len(children(candidate, func(n string) bool { return strings.HasPrefix(n, "com.st.stm32cube.ide.mcu.externaltools.") })) > 0 {
			return canonical(candidate)
		}
	}
	return "", fmt.Errorf("CubeIDE plugins not found in selected installation")
}
func component(plugins, family, binary string, h toolHost) string {
	matches := children(plugins, func(n string) bool { return strings.HasPrefix(n, "com.st.stm32cube.ide.mcu.externaltools."+family+".") })
	descending(matches)
	for _, p := range matches {
		if resolved, err := executablePath(filepath.Join(p, "tools", "bin", binary+h.suffix()), h.OS); err == nil {
			return resolved
		}
	}
	return ""
}
func recognizeIDE(original, source string, h toolHost) toolCandidate {
	c := toolCandidate{Kind: "cubeIDE", Original: original, Source: source, Components: map[string]string{}}
	plugins, err := pluginDirectory(h.inputPath(original))
	if err != nil {
		c.Reason = err.Error()
		return c
	}
	c.Resolved = plugins
	c.Installation = plugins
	c.Version = installationVersion(original, plugins)
	for _, t := range ideComponents {
		pluginsForTool := children(plugins, func(n string) bool {
			return strings.HasPrefix(n, "com.st.stm32cube.ide.mcu.externaltools."+t.family+".")
		})
		descending(pluginsForTool)
		if len(pluginsForTool) == 0 {
			c.Files = append(c.Files, fileValidation{Tool: t.key, Original: plugins, Reason: "required plugin family absent: " + t.family})
		}
		for _, plugin := range pluginsForTool {
			original := filepath.Join(plugin, "tools", "bin", t.binary+h.suffix())
			resolved, err := executablePath(original, h.OS)
			result := fileValidation{Tool: t.key, Original: original, Resolved: resolved, Valid: err == nil, Reason: "regular executable file"}
			if err != nil {
				result.Reason = err.Error()
			}
			c.Files = append(c.Files, result)
			if err == nil && c.Components[t.key] == "" {
				c.Components[t.key] = resolved
			}
		}
	}
	c.Valid = len(c.Components) > 0
	var unavailable []string
	for _, action := range []string{"build", "debug", "flash"} {
		var missing []string
		for _, key := range actionRequirements[action] {
			if c.Components[key] == "" {
				missing = append(missing, key)
			}
		}
		if len(missing) > 0 {
			unavailable = append(unavailable, action+": missing "+strings.Join(missing, ", "))
		}
	}
	c.Reason = "recognized CubeIDE installation"
	if len(unavailable) > 0 {
		c.Reason += "; " + strings.Join(unavailable, "; ")
	}
	return c
}

var namedProductVersion = regexp.MustCompile(`(?i)(?:STM32CubeIDE|STM32CubeMX)[-_ .v]*([0-9]+(?:\.[0-9]+)*)`)
var plistVersion = regexp.MustCompile(`(?s)<key>CFBundleShortVersionString</key>\s*<string>([0-9]+(?:\.[0-9]+)*)</string>`)

func metadataFile(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	data, _ := io.ReadAll(io.LimitReader(f, 16384))
	return string(data)
}
func namedVersion(path string) string {
	if m := namedProductVersion.FindStringSubmatch(filepath.Base(path)); len(m) > 1 {
		return m[1]
	}
	return ""
}
func bundleVersion(path string) string {
	for p, n := path, 0; n < 8 && p != filepath.Dir(p); p, n = filepath.Dir(p), n+1 {
		if strings.HasSuffix(strings.ToLower(p), ".app") {
			if m := plistVersion.FindStringSubmatch(metadataFile(filepath.Join(p, "Contents/Info.plist"))); len(m) > 1 {
				return m[1]
			}
		}
	}
	return ""
}
func installationVersion(original, plugins string) string {
	for _, line := range strings.Split(metadataFile(filepath.Join(filepath.Dir(plugins), ".eclipseproduct")), "\n") {
		if key, value, ok := strings.Cut(line, "="); ok && strings.TrimSpace(key) == "version" {
			return strings.TrimSpace(value)
		}
	}
	if version := bundleVersion(plugins); version != "" {
		return version
	}
	for p := original; p != filepath.Dir(p); p = filepath.Dir(p) {
		if version := namedVersion(p); version != "" {
			return version
		}
	}
	return ""
}
func recognizeFile(kind, original, source string, h toolHost) toolCandidate {
	c := toolCandidate{Kind: kind, Original: original, Source: source}
	original = h.inputPath(original)
	var paths []string
	if kind == "cubeMX" {
		paths = append(paths, filepath.Join(original, "Contents", "MacOS", "STM32CubeMX"))
	}
	paths = append(paths, original)
	names := []string{"make" + h.suffix()}
	if kind == "cubeMX" {
		names = []string{"STM32CubeMX" + h.suffix(), "stm32cubemx", "STM32CubeMX.app/Contents/MacOS/STM32CubeMX"}
	}
	for _, n := range names {
		paths = append(paths, filepath.Join(original, filepath.FromSlash(n)))
	}
	for _, p := range paths {
		resolved, err := executablePath(p, h.OS)
		if err == nil {
			c.Valid = true
			c.Resolved = resolved
			c.Reason = "regular executable file"
			c.Version = bundleVersion(original)
			if c.Version == "" {
				c.Version = namedVersion(original)
			}
			return c
		} else {
			c.Reason = err.Error()
		}
	}
	return c
}
func installationLocations(h toolHost) []string {
	var out []string
	var visit func(string, int)
	visit = func(root string, depth int) {
		out = append(out, root)
		if depth == 0 {
			return
		}
		for _, p := range children(root, func(n string) bool {
			n = strings.ToLower(n)
			return n == "stmicroelectronics" || n == "st" || n == "stm32cube" || strings.HasPrefix(n, "stm32cubeide") || strings.HasPrefix(n, "stm32cubemx")
		}) {
			visit(p, depth-1)
		}
	}
	for _, root := range h.roots() {
		visit(root, 4)
	}
	return unique(out)
}
func suitable(tools map[string]string, action string) bool {
	for _, k := range actionRequirements[action] {
		if tools[k] == "" {
			return false
		}
	}
	return true
}
func copyTools(tools map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range tools {
		out[k] = v
	}
	return out
}
func numericVersion(value string) []string { return regexpNumbers(value) }
func regexpNumbers(value string) []string {
	var out []string
	for _, p := range numberParts.FindAllString(value, -1) {
		if len(p) > 0 && p[0] >= '0' && p[0] <= '9' {
			out = append(out, p)
		}
	}
	return out
}
func newerCandidate(a, b toolCandidate) bool {
	if (a.Source == "previous") != (b.Source == "previous") {
		return a.Source == "previous"
	}
	av, bv := strings.Join(numericVersion(a.Version), "."), strings.Join(numericVersion(b.Version), ".")
	if av != bv {
		return naturalLess(bv, av)
	}
	return a.Original < b.Original
}
func discoverShared(h toolHost, opts options, previous map[string]string, diagnostics bool) toolsReport {
	r := toolsReport{SchemaVersion: 1, Version: version, Tools: map[string]string{}, Checks: []check{}, Details: map[string]toolCandidate{}, Alternatives: map[string][]toolCandidate{}, Actions: map[string]map[string]string{}, Selection: map[string]string{}}
	var ides, makes, mxs []toolCandidate
	ideCache := map[string]toolCandidate{}
	seenCandidates := map[string]bool{}
	add := func(kind, original, source string) {
		if original == "" {
			return
		}
		var c toolCandidate
		if kind == "cubeIDE" {
			if cached, ok := ideCache[original]; ok {
				c = cached
				c.Source = source
			} else {
				c = recognizeIDE(original, source, h)
				ideCache[original] = c
			}
			identity := source + "|cubeIDE|" + c.Resolved
			if c.Resolved == "" {
				identity += original
			}
			if seenCandidates[identity] {
				return
			}
			seenCandidates[identity] = true
			ides = append(ides, c)
		} else {
			c = recognizeFile(kind, original, source, h)
			if kind == "make" {
				makes = append(makes, c)
			} else {
				mxs = append(mxs, c)
			}
		}
		r.Candidates = append(r.Candidates, c)
	}
	if opts.ide != "" {
		add("cubeIDE", opts.ide, "explicit")
	}
	if opts.make != "" {
		add("make", opts.make, "explicit")
	}
	if opts.cubeMX != "" {
		add("cubeMX", opts.cubeMX, "explicit")
	}
	for _, k := range []string{"gcc", "gdb", "server", "programmer", "objcopy"} {
		if p := previous[k]; p != "" {
			resolved, validationError := executablePath(p, h.OS)
			known := toolCandidate{Kind: k, Original: p, Resolved: resolved, Source: "previous", Valid: validationError == nil, Reason: "regular executable file"}
			if validationError != nil {
				known.Reason = validationError.Error()
			}
			r.Candidates = append(r.Candidates, known)
			for dir, n := filepath.Dir(p), 0; n < 8 && dir != filepath.Dir(dir); dir, n = filepath.Dir(dir), n+1 {
				if plugins, err := pluginDirectory(dir); err == nil {
					add("cubeIDE", plugins, "previous")
					break
				}
			}
		}
	}
	if previous["shell"] == "" {
		add("make", previous["make"], "previous")
	}
	add("cubeMX", previous["cubeMX"], "previous")
	for _, loc := range installationLocations(h) {
		if _, err := pluginDirectory(loc); err == nil || strings.Contains(strings.ToLower(filepath.Base(loc)), "stm32cubeide") {
			add("cubeIDE", loc, "installation")
		}
		if strings.Contains(strings.ToLower(filepath.Base(loc)), "cubemx") {
			add("cubeMX", loc, "installation")
		}
	}
	for _, key := range []string{"STM32CUBEIDE_PATH", "STM32CUBEMX_PATH"} {
		kind := "cubeIDE"
		if key == "STM32CUBEMX_PATH" {
			kind = "cubeMX"
		}
		add(kind, h.env(key), "environment")
	}
	sep := ":"
	if h.OS == "windows" {
		sep = ";"
	}
	for _, dir := range strings.Split(h.env("PATH"), sep) {
		if dir != "" {
			dir = strings.Trim(dir, "\"")
			add("make", filepath.Join(dir, "make"+h.suffix()), "PATH")
			add("cubeMX", filepath.Join(dir, "STM32CubeMX"+h.suffix()), "PATH")
			if h.OS != "windows" {
				add("cubeMX", filepath.Join(dir, "stm32cubemx"), "PATH")
			}
		}
	}
	sort.SliceStable(mxs, func(i, j int) bool { return newerCandidate(mxs[i], mxs[j]) })
	sort.SliceStable(ides, func(i, j int) bool { return newerCandidate(ides[i], ides[j]) })
	for kind, list := range map[string][]toolCandidate{"cubeIDE": ides, "make": makes, "cubeMX": mxs} {
		seen := map[string]bool{}
		for _, c := range list {
			if c.Valid && c.Source != "explicit" && !seen[c.Resolved] {
				r.Alternatives[kind] = append(r.Alternatives[kind], c)
				seen[c.Resolved] = true
			}
		}
	}
	chooseFile := func(list []toolCandidate, explicit string) (toolCandidate, bool) {
		if explicit != "" {
			for _, c := range list {
				if c.Source == "explicit" {
					return c, c.Valid
				}
			}
		}
		for _, c := range list {
			if c.Valid {
				return c, true
			}
		}
		return toolCandidate{}, false
	}
	makeChoice, makeOK := chooseFile(makes, opts.make)
	mxChoice, mxOK := chooseFile(mxs, opts.cubeMX)
	for _, action := range []string{"build", "flash", "debug", "setup"} {
		for _, ide := range ides {
			if !ide.Valid || (opts.ide != "" && ide.Source != "explicit") {
				continue
			}
			tools := copyTools(ide.Components)
			// GNU Make has no ABI dependency on the ARM toolchain. Other IDE components
			// must come from one installation; partial installations are never combined.
			if makeOK {
				tools["make"] = makeChoice.Resolved
			} else if opts.make != "" {
				delete(tools, "make")
			}
			if !suitable(tools, action) {
				continue
			}
			r.Actions[action] = map[string]string{}
			for _, key := range actionRequirements[action] {
				r.Actions[action][key] = tools[key]
			}
			r.Selection[action] = "selected " + ide.Source + " suitable installation; newest numeric version then stable path; GNU Make may be independent"
			if action == "setup" {
				r.Tools = copyTools(tools)
				r.Details["cubeIDE"] = ide
			}
			break
		}
	}
	if len(r.Tools) == 0 {
		for _, ide := range ides {
			if ide.Valid && (opts.ide == "" || ide.Source == "explicit") {
				r.Tools = copyTools(ide.Components)
				r.Details["cubeIDE"] = ide
				break
			}
		}
	}
	if opts.make != "" && !makeOK {
		delete(r.Tools, "make")
	}
	if makeOK {
		r.Tools["make"] = makeChoice.Resolved
		r.Details["make"] = makeChoice
	}
	if mxOK {
		r.Tools["cubeMX"] = mxChoice.Resolved
		r.Actions["cubeMX"] = map[string]string{"cubeMX": mxChoice.Resolved}
		r.Details["cubeMX"] = mxChoice
	}
	for _, ide := range ides {
		if ide.Resolved == "" {
			continue
		}
		for k, p := range r.Tools {
			if ide.Components[k] == p && r.Details[k].Resolved == "" {
				c := ide
				c.Kind = k
				c.Components = nil
				c.Files = nil
				for _, validation := range ide.Files {
					if validation.Tool == k {
						c.Files = append(c.Files, validation)
					}
				}
				c.Resolved = p
				r.Details[k] = c
			}
		}
	}
	for _, supplied := range []struct{ kind, path string }{{"cubeIDE", opts.ide}, {"make", opts.make}, {"cubeMX", opts.cubeMX}} {
		kind, p := supplied.kind, supplied.path
		if p != "" {
			for _, c := range r.Candidates {
				if c.Kind == kind && c.Source == "explicit" && !c.Valid {
					r.Details[kind] = c
					action := "selectCubeIDE"
					if kind == "make" {
						action = "selectMake"
					}
					if kind == "cubeMX" {
						action = "selectCubeMX"
					}
					r.Checks = append(r.Checks, check{kind, kind, "error", c.Reason, action})
				}
			}
		}
	}
	for _, key := range actionRequirements["setup"] {
		status, message := "ok", r.Tools[key]
		if message == "" {
			status = "error"
			message = "Required executable unavailable: " + key
		}
		action := "selectCubeIDE"
		if key == "make" {
			action = "selectMake"
		}
		r.Checks = append(r.Checks, check{key, key, status, message, action})
	}
	if !mxOK {
		r.Checks = append(r.Checks, check{"cubeMX", "STM32CubeMX", "warning", "CubeMX unavailable; select an installation or open official downloads", "selectCubeMX"})
	}
	if !diagnostics {
		r.Candidates = nil
		r.Selection = nil
	}
	return r
}
func toolsCommand(args []string) error {
	opts, err := parseOptions(args, true)
	if err != nil {
		return err
	}
	if opts.project != "" || opts.probeSerial != "" {
		return fmt.Errorf("tools does not accept project or probe arguments")
	}
	return json.NewEncoder(os.Stdout).Encode(discoverShared(currentToolHost(), opts, opts.known, opts.diagnostics))
}
