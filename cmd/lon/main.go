package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"dauhuniec"
)

var assets = dauhuniec.Assets

const version = "0.1.1"
const stateDir = ".dauhuniec"
const previousStateDir = ".lon"
const legacyStateDir = ".stm32-codeready"

type project struct {
	Target   string `json:"target"`
	BuildDir string `json:"build_dir"`
	Device   string `json:"device"`
	IOC      string `json:"ioc"`
}

type config struct {
	Project project           `json:"project"`
	Tools   map[string]string `json:"tools"`
}

type options struct {
	probeSerial string
	project     string
	ide         string
	make        string
	json        bool
}

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}

func dispatch(args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		fmt.Println(`lon setup [PROJECT] [--cube-ide PATH] [--make PATH]
lon inspect|doctor [--project PATH] [--json] [--cube-ide PATH] [--make PATH]
lon build|clean|flash|upload|list-probes [--project PATH]
lon probes --json [--project PATH]
lon select-probe --probe-serial SERIAL [--project PATH] [--json]
lon serial-list
lon serial-monitor --port PORT --baud 115200
lon serial-console --port PORT [--baud 115200] [--log FILE] [--hex]
lon --version

Generate your STM32 project with CubeMX (Toolchain / IDE = Makefile).
setup installs this executable and VS Code settings into the selected project.
Without a project path, use the installed project or the current directory.`)
		return nil
	}
	if args[0] == "--version" {
		fmt.Printf("lon %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
		return nil
	}
	action := args[0]
	if action == "serial-console" {
		return serialConsoleCommand(args[1:], os.Stdin, os.Stdout)
	}
	if action == "serial-list" || action == "serial-monitor" {
		return serialCommand(action, args[1:], os.Stdin, os.Stdout)
	}
	switch action {
	case "setup", "inspect", "build", "clean", "doctor", "flash", "upload", "list-probes", "probes", "select-probe":
	default:
		return fmt.Errorf("unknown command %q; use --help", action)
	}
	opts, err := parseOptions(args[1:], action == "setup" || action == "inspect" || action == "doctor")
	if err != nil {
		return err
	}
	root, err := projectRoot(opts.project)
	if err != nil {
		return err
	}
	if opts.json && action != "inspect" && action != "doctor" && action != "probes" && action != "select-probe" {
		return errors.New("--json is supported by inspect, doctor, probes and select-probe")
	}
	if opts.probeSerial != "" && action != "flash" && action != "upload" && action != "select-probe" {
		return errors.New("--probe-serial is supported by flash, upload and select-probe")
	}
	if action == "setup" {
		return setup(root, opts)
	}
	if action == "inspect" || action == "doctor" {
		return printReport(inspect(root, opts, action == "doctor"), opts.json)
	}
	cfg, err := loadConfig(root)
	if err != nil {
		return err
	}
	if action == "probes" || action == "select-probe" {
		probes, err := listProbes(root, cfg)
		if err != nil {
			return err
		}
		if action == "select-probe" {
			if opts.probeSerial == "" {
				return errors.New("select-probe requires --probe-serial")
			}
			selected, err := chooseProbe(probes, nil, opts.probeSerial)
			if err != nil {
				return err
			}
			executable, err := os.Executable()
			if err != nil {
				return err
			}
			if err := copyFile(executable, filepath.Join(root, stateDir, binaryName()), 0755); err != nil {
				return err
			}
			if err := saveSelectedProbe(root, selected); err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(selected)
		}
		selected, err := readSelectedProbe(root)
		report := probeReport{SchemaVersion: 1, Probes: probes, Selected: selected}
		if err != nil {
			report.SelectionError = err.Error()
		}
		return json.NewEncoder(os.Stdout).Encode(report)
	}
	serial := ""
	if action == "flash" || action == "upload" {
		selected, err := requireProbe(root, cfg, opts.probeSerial)
		if err != nil {
			return err
		}
		serial = selected.Serial
	}
	return perform(root, action, cfg, run, serial)
}

func parseOptions(args []string, setup bool) (options, error) {
	var opts options
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--json":
			opts.json = true
		case "--probe-serial":
			i++
			if i == len(args) || !probeSerialPattern.MatchString(args[i]) || opts.probeSerial != "" {
				return opts, errors.New("specify one valid --probe-serial SERIAL")
			}
			opts.probeSerial = strings.ToUpper(args[i])
		case "--project", "--cube-ide", "--make":
			key := args[i]
			if key != "--project" && !setup {
				return opts, fmt.Errorf("%s is only supported with setup", key)
			}
			i++
			if i == len(args) || args[i] == "" {
				return opts, fmt.Errorf("%s requires a path", key)
			}
			switch key {
			case "--project":
				if opts.project != "" {
					return opts, errors.New("specify one project")
				}
				opts.project = args[i]
			case "--cube-ide":
				opts.ide = args[i]
			case "--make":
				opts.make = args[i]
			}
		default:
			if !setup || strings.HasPrefix(args[i], "-") || opts.project != "" {
				return opts, fmt.Errorf("unexpected argument %q; use --help", args[i])
			}
			opts.project = args[i]
		}
	}
	return opts, nil
}

func projectRoot(explicit string) (string, error) {
	if explicit == "" {
		exe, err := os.Executable()
		if err != nil {
			return "", err
		}
		exe, err = filepath.EvalSymlinks(exe)
		if err != nil {
			return "", err
		}
		if filepath.Base(filepath.Dir(exe)) == stateDir {
			explicit = filepath.Dir(filepath.Dir(exe))
		} else {
			explicit, err = os.Getwd()
			if err != nil {
				return "", err
			}
		}
	}
	return canonical(explicit)
}

func canonical(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(absolute)
}

func readProject(root string) (project, error) {
	var p project
	iocs, err := filepath.Glob(filepath.Join(root, "*.ioc"))
	if err != nil {
		return p, err
	}
	if !regularFile(filepath.Join(root, "Makefile")) || len(iocs) != 1 {
		return p, errors.New("select a CubeMX project containing Makefile and exactly one .ioc; generate code with Toolchain / IDE = Makefile under the project root")
	}
	data, err := os.ReadFile(iocs[0])
	if err != nil {
		return p, err
	}
	properties := make(map[string]string)
	for _, line := range strings.Split(strings.TrimPrefix(string(data), "\ufeff"), "\n") {
		if key, value, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			properties[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	if properties["ProjectManager.TargetToolchain"] != "Makefile" {
		return p, errors.New("select Toolchain / IDE = Makefile in CubeMX and regenerate code first")
	}
	device := strings.ToUpper(properties["Mcu.CPN"])
	if device == "" {
		device = strings.ToUpper(properties["Mcu.Name"])
	}
	if !regexp.MustCompile(`^STM32[A-Z0-9]+$`).MatchString(device) || strings.HasPrefix(device, "STM32MP") {
		return p, errors.New("expected a single-core STM32 MCU project with a CubeMX-generated GCC Makefile")
	}
	data, err = os.ReadFile(filepath.Join(root, "Makefile"))
	if err != nil {
		return p, err
	}
	values := make(map[string]string)
	for _, key := range []string{"TARGET", "BUILD_DIR"} {
		re := regexp.MustCompile(`(?m)^[\t ]*` + key + `[\t ]*:?=[\t ]*([^#\r\n]+)`)
		matches := re.FindAllStringSubmatch(strings.TrimPrefix(string(data), "\ufeff"), -1)
		if len(matches) != 1 {
			return p, fmt.Errorf("expected one literal %s assignment in Makefile", key)
		}
		values[key] = strings.TrimSpace(matches[0][1])
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(values["TARGET"]) {
		return p, errors.New("use Latin letters, numbers, underscores or hyphens for the CubeMX project name")
	}
	if err := checkBuildDir(root, values["BUILD_DIR"]); err != nil {
		return p, err
	}
	return project{values["TARGET"], filepath.ToSlash(filepath.Clean(values["BUILD_DIR"])), device, filepath.Base(iocs[0])}, nil
}

func checkBuildDir(root, name string) error {
	invalid := errors.New("BUILD_DIR must be a relative output directory such as build, outside sources and without symlinks")
	if !regexp.MustCompile(`^[A-Za-z0-9_./-]+$`).MatchString(name) || filepath.IsAbs(name) {
		return invalid
	}
	parts := strings.Split(strings.TrimSuffix(name, "/"), "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return invalid
		}
	}
	switch parts[0] {
	case "Core", "Drivers", "Src", "Inc", ".git", ".vscode", stateDir, previousStateDir, legacyStateDir:
		return invalid
	}
	current := root
	for _, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return invalid
		}
	}
	return nil
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

var numberParts = regexp.MustCompile(`[0-9]+|[^0-9]+`)

func naturalLess(a, b string) bool {
	aa, bb := numberParts.FindAllString(strings.ToLower(a), -1), numberParts.FindAllString(strings.ToLower(b), -1)
	for i := 0; i < len(aa) && i < len(bb); i++ {
		if aa[i] == bb[i] {
			continue
		}
		x, ex := strconv.ParseUint(aa[i], 10, 64)
		y, ey := strconv.ParseUint(bb[i], 10, 64)
		if ex == nil && ey == nil && x != y {
			return x < y
		}
		return aa[i] < bb[i]
	}
	return len(aa) < len(bb)
}

func descending(paths []string) {
	sort.Slice(paths, func(i, j int) bool { return naturalLess(paths[j], paths[i]) })
}

func findPlugins(explicit string) (string, error) {
	candidates := []string{explicit}
	if explicit == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		patterns := []string{"/Applications/STM32CubeIDE*.app", "/opt/st/stm32cubeide*",
			filepath.Join(home, "st/stm32cubeide*"), filepath.Join(home, "STMicroelectronics/STM32Cube/STM32CubeIDE*"),
			"C:/ST/STM32CubeIDE*", "C:/Program Files/STMicroelectronics/STM32Cube/STM32CubeIDE*"}
		candidates = nil
		for _, pattern := range patterns {
			matches, err := filepath.Glob(filepath.FromSlash(pattern))
			if err != nil {
				return "", err
			}
			candidates = append(candidates, matches...)
		}
		descending(candidates)
	}
	for _, root := range candidates {
		for _, suffix := range []string{"", "plugins", "STM32CubeIDE/plugins", "Contents/Eclipse/plugins", "STM32CubeIDE.app/Contents/Eclipse/plugins"} {
			candidate := filepath.Join(root, filepath.FromSlash(suffix))
			matches, _ := filepath.Glob(filepath.Join(candidate, "com.st.stm32cube.ide.mcu.externaltools.*"))
			for _, match := range matches {
				if info, err := os.Stat(match); err == nil && info.IsDir() {
					return canonical(candidate)
				}
			}
		}
	}
	return "", errors.New("CubeIDE tools not found; use setup --cube-ide <installation-or-plugins-directory>")
}

func findTool(plugins, family, binary string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(plugins, "com.st.stm32cube.ide.mcu.externaltools."+family+".*"))
	if err != nil {
		return "", err
	}
	descending(matches)
	for _, plugin := range matches {
		path := filepath.Join(plugin, "tools", "bin", binary+exeSuffix())
		if regularFile(path) {
			return canonical(path)
		}
	}
	return "", fmt.Errorf("missing %s in %s; check the full CubeIDE installation", binary, plugins)
}

func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

func binaryName() string { return "lon" + exeSuffix() }

func setup(root string, opts options) error {
	p, err := readProject(root)
	if err != nil {
		return err
	}
	discovery := discoverTools(opts, savedTools(root))
	if message := checkErrors(discovery.Checks); message != "" {
		return errors.New(message)
	}
	plugins := discovery.Plugins
	cfg := config{Project: p, Tools: discovery.Tools}
	for _, key := range []string{"gcc", "gdb", "make"} {
		if err := run(root, []string{cfg.Tools[key], "--version"}, nil); err != nil {
			return err
		}
	}
	state := filepath.Join(root, stateDir)
	if err := realDir(state); err != nil {
		return err
	}
	if err := realDir(filepath.Join(root, ".vscode")); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := copyFile(exe, filepath.Join(state, binaryName()), 0755); err != nil {
		return err
	}
	if err := configureVSCode(root, plugins, cfg); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(state, "tools.json"), cfg); err != nil {
		return err
	}
	if selected, err := readSelectedProbe(root); err != nil {
		return err
	} else if selected != nil {
		if err := saveSelectedProbe(root, *selected); err != nil {
			return err
		}
	}
	readme, err := assets.ReadFile("extension/README.md")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(state, "README.md"), readme, 0644); err != nil {
		return err
	}
	license, err := assets.ReadFile("GO-LICENSE.txt")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(state, "GO-LICENSE.txt"), license, 0644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(state, ".gitignore"), []byte("tools.json\ntarget.json\nbackups/\nlon\nlon.exe\n"), 0644); err != nil {
		return err
	}
	fmt.Printf("Setup complete. Open %s in VS Code. Run Task > Build; F5: debug.\n", root)
	return nil
}

func realDir(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return os.Mkdir(path, 0755)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("expected a real directory, not a symlink: %s", path)
	}
	return nil
}

func copyFile(source, destination string, mode fs.FileMode) error {
	sourceInfo, err := os.Stat(source)
	if err != nil {
		return err
	}
	if destinationInfo, err := os.Stat(destination); err == nil && os.SameFile(sourceInfo, destinationInfo) {
		return nil
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.CreateTemp(filepath.Dir(destination), ".practice-copy-*")
	if err != nil {
		return err
	}
	defer os.Remove(out.Name())
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Chmod(out.Name(), mode); err != nil {
		return err
	}
	return os.Rename(out.Name(), destination)
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("cannot back up symlink %s; use a regular .vscode directory", path)
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported file in .vscode: %s", path)
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0644)
}

func loadConfig(root string) (config, error) {
	var cfg config
	data, err := os.ReadFile(filepath.Join(root, stateDir, "tools.json"))
	if err != nil {
		return cfg, fmt.Errorf("run lon setup first: %w", err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	for _, key := range []string{"gcc", "gdb", "objcopy", "objdump", "nm", "size", "server", "programmer", "make"} {
		if !regularFile(cfg.Tools[key]) {
			return cfg, fmt.Errorf("tool %s missing; run setup again", key)
		}
	}
	if runtime.GOOS == "windows" && !regularFile(cfg.Tools["shell"]) {
		return cfg, errors.New("MSYS2 shell missing; run setup again")
	}
	p, err := readProject(root)
	if err != nil {
		return cfg, err
	}
	if p != cfg.Project {
		return cfg, errors.New("CubeMX project name/build directory changed; run setup again")
	}
	return cfg, nil
}

type runner func(root string, command []string, environment []string) error

func run(root string, command []string, environment []string) error {
	fmt.Println("+", strings.Join(command, " "))
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir, cmd.Env = root, environment
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

func build(root string, cfg config, execute runner) error {
	path := strings.Join([]string{filepath.Dir(cfg.Tools["gcc"]), filepath.Dir(cfg.Tools["make"]), os.Getenv("PATH")}, string(os.PathListSeparator))
	var environment []string
	for _, variable := range os.Environ() {
		key, _, _ := strings.Cut(variable, "=")
		if !strings.EqualFold(key, "PATH") {
			environment = append(environment, variable)
		}
	}
	environment = append(environment, "PATH="+path)
	command := []string{cfg.Tools["make"], "-j2", "GCC_PATH=", "PREFIX=arm-none-eabi-", "DEBUG=1", "OPT=-Og", "all"}
	if runtime.GOOS == "windows" {
		command = append(command, "SHELL=sh.exe")
	}
	return execute(root, command, environment)
}

func elfPath(root string, p project) string { return filepath.Join(root, p.BuildDir, p.Target+".elf") }

func perform(root, action string, cfg config, execute runner, probeSerial ...string) error {
	switch action {
	case "build":
		return build(root, cfg, execute)
	case "flash", "upload":
		if action == "flash" {
			if err := build(root, cfg, execute); err != nil {
				return err
			}
		}
		elf := elfPath(root, cfg.Project)
		if !regularFile(elf) {
			return fmt.Errorf("firmware ELF not found at %s; run Build Firmware first", elf)
		}
		command := []string{cfg.Tools["programmer"], "-c", "port=SWD"}
		if len(probeSerial) > 0 && probeSerial[0] != "" {
			command = append(command, "sn="+probeSerial[0])
		}
		command = append(command, "-w", elf, "-v", "-rst")
		return execute(root, command, nil)
	case "clean":
		if err := checkBuildDir(root, cfg.Project.BuildDir); err != nil {
			return err
		}
		path := filepath.Join(root, cfg.Project.BuildDir)
		if err := os.RemoveAll(path); err != nil {
			return err
		}
		fmt.Println("Removed", path)
	case "doctor":
		for _, key := range []string{"gcc", "gdb", "make"} {
			if err := execute(root, []string{cfg.Tools[key], "--version"}, nil); err != nil {
				return err
			}
		}
		fmt.Println("Tool paths and GCC/GDB/Make launches OK. USB/board connection was not checked.")
	case "list-probes":
		return execute(root, []string{cfg.Tools["programmer"], "-l", "st-link-only"}, nil)
	default:
		return fmt.Errorf("unknown action %q", action)
	}
	return nil
}
