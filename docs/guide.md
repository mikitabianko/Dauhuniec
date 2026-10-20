# Dauhuniec

<img src="../assets/logo.png" alt="Dauhuniec — flax flower" width="160">

**Dauhuniec · CLI: `lon`**

## Upgrading from previous versions

Disable the old extension, install the new VSIX, and run
**Dauhuniec: Configure CubeMX Project** once for each existing project.
Configuration reuses the existing tool paths, migrates local `lon.*` and
`codeready.*` settings to `dauhuniec.*`, replaces generated tasks, and preserves
the selected ST-LINK board. New files are stored in `.dauhuniec/`; the old `.lon/`
and `.stm32-codeready/` directories remain available for rolling back to the
previous version. Set global extension settings again under `dauhuniec.*`.

Go from an **STM32CubeMX** project to building, flashing, and debugging in
**VS Code**. The extension guides you through configuration, shows tool status,
and provides ready-to-use commands. The bundled Go CLI performs the main work.

Users do not need Python, Go, Rust, or a separate Node.js installation. Native
CLIs are supplied for Windows, macOS, and Linux on x86_64 and ARM64.

## Quick start

1. Create or open a project in CubeMX. Configure the board and peripherals.
2. Under **Project Manager → Project → Toolchain / IDE**, select **Makefile**.
   Generate code in the project root, which should contain one `.ioc` file and a `Makefile`.
3. Install the tools listed below.
4. In VS Code, select **Extensions → … → Install from VSIX…** and install
   `releases/dauhuniec-0.1.1.vsix`.
5. Open your project folder and select **Dauhuniec → Configure project**.
   The extension also offers configuration when it first detects a project.
6. If tools are not found, select the CubeIDE directory or GNU Make executable.
7. Click **Build firmware**. After connecting ST-LINK, you can use
   **Build, flash and run** and **Start debugging**.

Projects in subfolders and selection between multiple `.ioc` files are supported.
For standard F5 debugging and IntelliSense, open the selected project's own
directory as a workspace folder: its `.vscode` directory must be at that folder's root.

## Hide generated CubeMX code

Open a `.c` or `.h` file containing `USER CODE BEGIN/END` blocks and run
**Dauhuniec: Focus on USER CODE** from the command palette. A toggle is also
available in the editor title bar and status bar. Generated sections between
blocks are folded; user blocks and their markers remain visible.

- **Dauhuniec: Show Full File** restores the full file view.
- **Dauhuniec: Toggle USER CODE Focus** toggles the mode.
- **Dauhuniec: Go to USER CODE Block** lists the blocks and moves the cursor to one.
- **Dauhuniec: Focus User Code On Open** enables automatic focus for opened files.
  It is off by default; explicit choices are remembered for each file.

This is an editor feature: it does not require a Makefile, compiler, or project
configuration. It also works in a fresh project exported for IAR/EWARM. Source
text is not rewritten, and building and CubeMX regeneration are unaffected.
Use the normal folding arrows to expand individual generated sections.

Code is not hidden if markers are incomplete or mismatched. If such an error
appears while editing in focus mode, the extension shows the full file.
Nested user blocks are preserved in full.

## Tools

- [STM32CubeMX](https://www.st.com/en/development-tools/stm32cubemx.html): configure
  pins, clocks, and peripherals, and generate source files and a Makefile.
- [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) with GNU Tools
  for STM32, ARM GDB, ST-LINK GDB server, and STM32CubeProgrammer. Its tools are
  used; you do not need to open the project in CubeIDE itself.
- [VS Code](https://code.visualstudio.com/), **C/C++** (`ms-vscode.cpptools`), and
  **Cortex-Debug** (`marus25.cortex-debug`). They are listed as companion extensions
  for Dauhuniec and can be installed manually.
- GNU Make. Docker, hvy, IAR, CMake, and probe-rs are not required for this workflow.

**Windows:** the extension automatically finds native GNU Make in the selected
STM32CubeIDE installation, alongside ARM GCC. No MSYS2, Git Bash, WSL or extra
build package is required. Install ST's ST-LINK driver and use regular VS Code
or PowerShell. See the [Windows setup guide](../extension/docs/windows.md).

**macOS:** install CubeIDE in `/Applications` and install Make with
`xcode-select --install`. Tools must support your computer's architecture.
The CLIs are not Developer ID signed; if macOS blocks a verified copy, use the
standard macOS procedure to allow it to run.

**Linux:** install `make` through your package manager and the ST-LINK udev rules
supplied with CubeIDE, then reconnect the board. See
[ST's manual](https://www.st.com/resource/en/user_manual/dm00603964-stm32cubeide-stmicroelectronics.pdf)
for GDB dependencies.

On Windows ARM64, check CubeIDE toolchain and USB driver compatibility separately.
In SSH/WSL/containers, the extension runs on the workspace host: tools and USB
access must be available there. Local development is the primary workflow.

## Commands

| Action | VS Code command palette command |
| --- | --- |
| Configure the project | `Dauhuniec: Configure CubeMX Project` |
| Select a project | `Dauhuniec: Select Project` |
| Check tools | `Dauhuniec: Check Environment` |
| Build | `Dauhuniec: Build` |
| Flash existing firmware without building | `Dauhuniec: Flash Firmware (Without Building)` |
| Build, flash with verification, and restart | `Dauhuniec: Build, Flash and Run` |
| Build and start debugging | `Dauhuniec: Start Debugging` |
| Remove build output | `Dauhuniec: Clean Build` |
| Find ST-LINK devices | `Dauhuniec: List ST-LINK Probes` |
| Open a project in CubeMX / create a new one | `Dauhuniec: Open in STM32CubeMX / Create Project` |
| Open logs | `Dauhuniec: Show Logs` |

All actions are also available in the sidebar. **Open in STM32CubeMX / Create Project**
opens the active or selected `.ioc` in a separate CubeMX instance for configuring
pins and peripherals. If there is no `.ioc` yet, including in an empty folder or
a window without a workspace, the command simply launches CubeMX to create a
project. When several `.ioc` files match, the extension asks you to select one.
The command is also available in the Dauhuniec panel title bar, its welcome view,
the `.ioc` editor title bar, and the file's Explorer context menu.

On Windows, macOS, and Linux, the extension searches standard directories and
`PATH` for CubeMX. On macOS, `.app` bundles are supported, including names with
version numbers. Set a custom path in `dauhuniec.cubeMXPath`: an executable,
installation directory, or `.app` bundle. If CubeMX is not installed or cannot
be found, a message offers to install it or specify its path. In SSH/WSL/containers,
CubeMX runs on the workspace host and requires an installation and an available
graphical session there.

After configuration, **Ctrl/Cmd+Shift+B** and **F5** work with the
**Dauhuniec: Debug** configuration. An existing default build task is preserved:
select **Dauhuniec: Build** under Run Build Task.

Connect USB to **ST-LINK** using a data cable, select **Target Board** if multiple
boards are connected, and close other debuggers. Debugging initially stops at `main`.
F10 steps over, F11 steps into, and F5 continues. **Dauhuniec: Attach** requires
the ELF matching the firmware already on the board.
Opening, inspecting, and configuring a project do not flash firmware.

## Changes to your project

The native CLI and local tool paths are added under `.dauhuniec/`.
Tasks, Cortex-Debug configurations, IntelliSense settings, and extension
recommendations are merged into `.vscode/`. Unrelated settings and tasks are preserved.

Original editor configuration files, including JSONC comments, are copied to
`.dauhuniec/backups/vscode-<timestamp>/`. Updated JSON files are reformatted.
Invalid JSON is not overwritten. Backups are intended for regular files and
directories without symbolic links.

Source files, drivers, `.ioc`, the linker script, and the Makefile remain unchanged.
The MCU is read from `.ioc`; flags, defines, and include paths come from the
Makefile. Builds run with `DEBUG=1 OPT=-Og`; the ELF path comes from `TARGET`
and `BUILD_DIR`.

After changing peripherals, click **Generate Code** in CubeMX. Keep your logic
inside `USER CODE` blocks. After changing the set of files, run Clean, then Build.
Run Configure again after renaming or moving a project, or updating CubeIDE.
Do not commit local `.vscode/settings.json`, `tools.json`, backups, or build
output to Git. Configure each new computer separately.

## CLI without the extension

From the Dauhuniec directory:

```powershell
.\setup.cmd "C:/STM32/Lab01"
```

```sh
sh setup.sh /path/to/Lab01 --cube-ide /opt/st/stm32cubeide_2.1.1 --make /usr/bin/make
```

Path options are optional: tools are detected automatically when omitted.
After setup, run the following from your project on macOS/Linux:

```sh
./.dauhuniec/lon inspect --json
./.dauhuniec/lon doctor --json
./.dauhuniec/lon build
./.dauhuniec/lon flash
./.dauhuniec/lon clean
```

On Windows, use `.\.dauhuniec\lon.exe`.
`inspect` checks the project structure and tool availability without running the
compiler. `doctor` also runs GCC/GDB/Make with `--version`. Both support
`--project`, `--cube-ide`, `--make`, and `--json`. JSON includes `schemaVersion: 1`,
a `checks` list with `ok/warning/error` statuses, `configured`, `ready`, and tool
paths. In JSON mode, problems are reported in the report fields rather than the
exit code. `flash` writes firmware only after a successful build and when the ELF
exists. `upload` writes an existing ELF without building; if the file is missing,
it asks you to build the project first.

The status bar provides separate buttons: **Home**, **Build Firmware**,
**Flash Firmware** (existing ELF), and **Build and Flash**. Each performs its
action in one click. **Stop** is shown while a task is running. Flashing includes
write verification and an MCU restart.

## Supported format

Standard single-core STM32 MCU projects exported from CubeMX as **Makefile**
projects with literal `TARGET`/`BUILD_DIR` values are supported. There is no
longer a restriction to STM32F429ZI. CMake, IAR/EWARM, CubeIDE-managed, STM32MP,
and multi-core projects are not converted automatically: select the required
export in CubeMX and regenerate the code.

Local validation is performed on Intel macOS with ARM GCC 14.3.1 from CubeIDE 2.1.1:
Go/TypeScript tests, an independent project copy in a path containing spaces,
preservation of user settings, and firmware builds. A separate VS Code Extension
Host checks extension activation and a real build task from the editor.
Other operating systems and architectures receive cross-compiled binaries;
physical boards and flashing/debugging sessions require validation on the
corresponding hardware.

## Select a board for flashing

In the Dauhuniec sidebar, under **Project → Target Board**, select a specific
board by its ST-LINK serial number. The model is shown if the programmer reports
it; identical models are distinguished by their full serial numbers. The serial
port selected in the console monitor is independent of this selection.

A single connected board is selected and remembered automatically. When opening
a configured project with multiple boards and no saved selection, the extension
immediately asks you to select a target. Cancelling does not assign the first
board by default. Connecting other devices or changing their order does not
change the saved target. If the selected board is disconnected, flashing and
debugging stop until it returns or you explicitly select another device in the sidebar.

The selection is stored per project in `.dauhuniec/target.json`, excluded from
Git, and preserved across VS Code restarts and Configure Project runs. Flashing,
uploading an existing ELF, and Dauhuniec Debug/F5 use the selected serial number.
Selecting a board updates the project's managed CLI so standard flashing tasks
also respect the target. The connection is checked again before each operation;
**Refresh** updates sidebar status. Ambiguous duplicate serial numbers are rejected.

In the CLI, `probes --project PATH --json` lists devices, and
`select-probe --project PATH --probe-serial SERIAL` saves the selection.
`flash` and `upload` use the saved target. The `--probe-serial SERIAL` flag
explicitly selects a device for one operation without changing the saved selection.

## Serial Monitor (COM port)

**Dauhuniec: Open Serial Monitor** or the terminal icon in the bottom toolbar
opens the port and baud rate picker, then starts a native console in VS Code's
bottom Terminal panel. The source editor stays in place. Opening the monitor
again shows the current session. Type a message and press Enter to send it.
Incoming telemetry preserves the current input line; Backspace and the left/right
arrows edit it. The connection uses 8N1 with no flow control.

Long incoming lines wrap to the terminal width. Resizing the window automatically
adjusts the input line; long drafts scroll horizontally without losing text.

Commands: /help shows help; /hex and /text select the receive format;
/ending lf|crlf|cr|none sets the outgoing line ending; /log PATH starts recording
RX/TX in JSONL with timestamps and original bytes; /logoff stops logging;
/clear clears the screen; /quit or Ctrl+C disconnects and exits.
Use // to send a line beginning with /.
Logging is off initially; existing files are appended to. The command palette
provides Serial Monitor: Start Logging (with a file picker) and Stop Logging.

The utility also works outside VS Code:

    lon serial-console --port COM3 --baud 115200
    lon serial-console --port /dev/cu.usbmodem144203 --log serial.jsonl

Windows, macOS, and Linux on x64 and ARM64 are supported. Additional Python or
serial utilities are not needed. A device driver and access to the port are
required. In SSH/WSL/containers, the USB port must be accessible on the workspace
host. Hiding the terminal does not interrupt the session; exit with /quit or
Ctrl+C to release the port. Whether the terminal survives a window reload depends
on VS Code settings. Physical communication on each operating system must be
tested on the corresponding hardware.

## Development

Go 1.22+, Node.js 20+, and pnpm 10 are needed only by maintainers. The CLI uses
go.bug.st/serial for serial ports. The extension has no runtime npm dependencies.
Dauhuniec is licensed under the [MIT License](../LICENSE).
Dependency licenses are included in THIRD-PARTY-NOTICES.txt.

```sh
go test ./...
go run ./cmd/package
cd extension
pnpm install --frozen-lockfile
node scripts/prepare.cjs
pnpm test
pnpm run package
```

Output: six CLIs in `bin/`, `SHA256SUMS`, and the installable
`releases/dauhuniec-0.1.1.vsix`. No separate ZIP is created. Binaries,
dependencies, compiled files, and VSIX packages are excluded from Git.

Extension sources are in `extension/src`; native logic is in the Go files under
`cmd/lon`. `extension/src/test/host.ts` checks activation and a real build task
in a separate VS Code Extension Host. From `extension`, run
`pnpm run test:host /path/to/configured/CubeMX/project`. It opens an isolated
VS Code profile, builds the project, and does not access the board.
The Go runtime license is in `GO-LICENSE.txt`. Before publishing to the
Marketplace, register your publisher and set it in `extension/package.json`;
the current identifier is for local packaging.

### Quick actions panel

The bottom-left area shows the selected CubeMX project and **Build**, **Flash**,
**Debug**, and **⋯** buttons. Clicking the project name switches the active
project. Until configuration is complete, a **Configure** button replaces build
actions. While a task is running, a progress indicator and stop button are shown;
after an error, a shortcut to **Problems** appears.

The **⋯** menu provides build cleanup, environment checks, the ST-LINK list,
`.ioc`, logs, the terminal, Problems, settings, and the guide. Build output stays
in the task terminal. The **USER CODE** toggle is on the right.

The top-right corner of the editor for C/C++ files with CubeMX markers provides
two buttons: **Focus on USER CODE / Show Full File** (toggle) and
**Go to USER CODE Block** (user block picker). Hover over a button to see its action.

USER CODE mode preserves function signatures, including multiline signatures,
and their opening and closing braces so you can see which function contains
each user block.

## MCU, board, HAL, and RTOS documentation

Open **Dauhuniec → Resources → Documentation · MCU / Board / HAL / RTOS**
or run **Dauhuniec: Open Documentation (MCU / Board / HAL / RTOS)**.
It is also available in Project, More Actions, and the `.ioc` title bar and context menu.

The MCU and board are detected from the selected project's `.ioc`; a Makefile
and build configuration are not required. This opens the Documentation section
on ST's website with the Datasheet, Reference Manual, Errata, board manuals, and
schematics where published. Internet access is required for the website.
The physical ST-LINK selected for flashing does not affect documentation.
If there are multiple projects, you can select the relevant `.ioc`.

**HAL / LL** opens complete original STMicroelectronics manuals. The manual for
the appropriate family is selected using the MCU from `.ioc`; without a project,
you can select a family through **HAL / LL · Choose STM32 family…**. The catalog
includes STM32F0/F1/F2/F3/F4/F7, G0/G4, H5/H7, L0/L1/L4/L5, U5, WB, and WL.
Manuals from other families are not substituted for WBA, WB0, or H7RS.
The official STM32Cube package's documentation page is also available. Check the
manual version against the project's package, especially when using a new HAL generation.

**RTOS** opens the complete FreeRTOS documentation and Arm's CMSIS-RTOS v1/v2 API
references. ST's UM1722 RTOS integration manual and the FreeRTOS V10.0.0 PDF,
clearly marked as a legacy version, are also available. Current APIs use the
online reference. Custom reference notes have been removed.
[Catalog of official sources](../extension/docs/SOURCES.md).

The first time a PDF is selected, it is downloaded from the publisher to the
extension's global storage on the workspace host. The manual then opens from
cache without internet access. **Update Downloaded Manual…** downloads a fresh
copy; the old copy is preserved if the download fails. FreeRTOS and Arm HTML
references open online: entire websites are not cached. If a download fails,
you can select **Open Online**.

Local project PDFs, Markdown, and HTML files appear in the same picker.
Set additional directories, such as an STM32Cube package containing a HAL manual,
in `dauhuniec.documentationPaths`: use absolute paths or paths relative to the
project. Up to 200 files are listed per directory; build and dependency
directories are excluded. **Open Local Document…** opens any downloaded document,
including third-party board schematics and documentation for other components.
**Choose MCU or ST board…** lets you specify a model manually if it is not
recognized in `.ioc`.

Markdown opens in VS Code. During local development, PDFs and HTML open in the
system viewer. In SSH/WSL/containers, files open through VS Code; a PDF viewer
extension may be required. If a network or proxy blocks downloads by the
extension, save the official PDF through a browser and open the local file.
