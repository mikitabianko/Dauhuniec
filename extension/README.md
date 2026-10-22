# Dauhuniec

**STM32 in VS Code: CubeMX → build → flash → debug, without rewriting your firmware project.**

<p align="center">
  <img src="https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/assets/logo.png" alt="Dauhuniec flax flower" width="160">
</p>

[![Install from Visual Studio Marketplace](https://img.shields.io/badge/Marketplace-Install-blue)](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec)
[![CI](https://github.com/mikitabianko/Dauhuniec/actions/workflows/release-extension.yml/badge.svg)](https://github.com/mikitabianko/Dauhuniec/actions/workflows/release-extension.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/mikitabianko/Dauhuniec/blob/master/LICENSE)

Keep CubeMX for pins, clocks and code generation. Use Dauhuniec for everyday
firmware development in VS Code: tool detection, builds, ST-LINK flashing,
Cortex-Debug integration and a serial monitor.

Dauhuniec is an **STM32 extension for Visual Studio Code (VS Code / VSCode)**
for embedded C/C++ development with **STM32CubeMX Makefile projects**,
**ARM GCC (`arm-none-eabi-gcc`)**, **ST-LINK** and **Cortex-Debug**.

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec) ·
[Quick start](#quick-start) ·
[User guide](https://github.com/mikitabianko/Dauhuniec/blob/master/docs/guide.md) ·
[Changelog](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/CHANGELOG.md) ·
[Report an issue](https://github.com/mikitabianko/Dauhuniec/issues)

| Build firmware | Select a target board |
| --- | --- |
| [![Successful Blink firmware build](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/build.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/build.png) | [![ST-LINK target selection](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/target-board.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/target-board.png) |
| **Serial monitor** | **Focus on USER CODE** |
| [![Serial data from NUCLEO-F411RE](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/serial-monitor.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/serial-monitor.png) | [![Generated code folded around USER CODE blocks](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-focus.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-focus.png) |

## Features

- **Guided project setup** — detect CubeIDE tools, configure build tasks, IntelliSense and debugging.
- **Build, flash and debug** — run actions from the sidebar, status bar or Command Palette.
- **ST-LINK target selection** — choose a board by serial number and remember it per project.
- **USER CODE focus** — fold generated sections while keeping editable blocks and their function context visible.
- **Serial monitor** — send and receive data in the terminal, switch UTF-8/HEX display and record RX/TX logs.
- **Documentation at hand** — find MCU, board, HAL/LL and RTOS references, cache catalogued HAL/LL and RTOS PDFs for offline reuse and open local documents.
- **Bundled native CLI** — use `lon` inside or outside VS Code on Windows, macOS and Linux, on x64 or ARM64.

## Installation

Install **[Dauhuniec from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec)**,
or search for **Dauhuniec** in the Extensions view. From a terminal:

```sh
code --install-extension dauhuniec.dauhuniec
```

Requires **VS Code 1.95 or later**. clangd and Cortex-Debug are declared as companion
extensions; install them manually if missing. The native CLI is included, so
extension users do not need Go, Python or a separate Node.js installation.

## Required tools

| Tool | Purpose |
| --- | --- |
| [STM32CubeMX](https://www.st.com/en/development-tools/stm32cubemx.html) | Configure the MCU and generate a **Makefile** project. |
| [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) | Provides ARM GCC, GDB, ST-LINK GDB server and STM32CubeProgrammer. You can use these tools without opening the project in CubeIDE. |
| GNU Make | Builds the generated Makefile. |
| STM32 board and ST-LINK | Required for flashing and debugging; an onboard ST-LINK is sufficient. |

- **Windows:** native Make is detected inside CubeIDE. Install the [ST-LINK USB driver](https://www.st.com/en/development-tools/stsw-link009.html) as needed. Follow the [Windows setup guide](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/docs/windows.md).
- **macOS:** install Command Line Tools with `xcode-select --install` to provide Make.
- **Linux:** install `make` through your package manager and [ST-LINK udev rules supplied with CubeIDE](https://www.st.com/resource/en/user_manual/um2563-stm32cubeide-installation-guide-stmicroelectronics.pdf). Ensure your user can access the USB device.

Open **Resources → Install Tools / Official Downloads** in the sidebar for official
download links. The serial monitor additionally needs an accessible serial port
and any required USB-to-serial driver.

## Quick start

Install Dauhuniec and the [required tools](#required-tools) first, then:

1. In **STM32CubeMX**, select **Project Manager → Project → Toolchain / IDE → Makefile**
   and generate code.
2. Open the generated folder in VS Code, with one `.ioc` file and the `Makefile`
   at its root. Trust the workspace, then choose **Dauhuniec → Configure Project**
   and select CubeIDE or Make if prompted.
3. Run **Dauhuniec: Check Environment**. Resolve any errors before continuing.
   This checks the project and tool paths and launches GCC, GDB and Make with
   `--version`; it does not test USB access or communication with the board.
4. Run **Dauhuniec: Build**.
5. Connect the board's **ST-LINK** USB connector with a data-capable cable, select
   **Project → Target Board** if needed, and run **Dauhuniec: Flash Firmware (Without Building)**.
   Later, **Build, Flash and Run** combines both actions.

Dauhuniec can detect projects in workspace subfolders and lets you select among
them. For normal F5 debugging and IntelliSense, open the project directory itself
as a workspace folder.

## Build, flash and debug

| Command Palette action | Result |
| --- | --- |
| **Dauhuniec: Build** | Compile firmware without flashing. |
| **Dauhuniec: Flash Firmware (Without Building)** | Flash the existing ELF, verify the write and restart the MCU. |
| **Dauhuniec: Build, Flash and Run** | Build, flash, verify and restart. |
| **Dauhuniec: Start Debugging** | Build and launch Cortex-Debug. |
| **Dauhuniec: Clean Build** | Remove build output. |
| **Dauhuniec: Check Environment** | Check the project and tool paths, and launch GCC, GDB and Make with `--version`. USB access and board communication are not tested. |

The status bar provides shortcuts for Home, CubeMX, Build, Flash, Build and Flash,
Debug and Serial Monitor. Hover over an icon for its action. **Stop** appears
while a cancellable task is running. Compiler diagnostics appear in Problems.

For F5, select **Dauhuniec: Debug** in Run and Debug. Setup also creates
**Dauhuniec: Attach** to connect to running firmware without a pre-launch build,
using the configured ELF for symbols. Existing default build tasks
are preserved; select **Dauhuniec: Build** explicitly if another task is the default.

Use **Project → Target Board** or **Dauhuniec: Select Target Board** to choose a
probe by ST-LINK serial number. A single connected probe is selected automatically.
The choice is remembered per project in `.dauhuniec/target.json`. If that probe is
disconnected, flashing and debugging report an error. Reconnect it or select
another target, then retry the action. The serial monitor's port is selected separately.

![Selecting NUCLEO-F411RE with NUCLEO-H723ZG also connected; ST-LINK serials are hidden](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/target-board.png)

ST-LINK serial numbers are hidden in these screenshots. Dauhuniec displays the
full numbers during normal use so identical boards can be distinguished.

![Cortex-Debug paused in the NUCLEO-F411RE Blink loop with blink_count in Watch](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/debug.png)

The debugging example runs on a physical NUCLEO-F411RE: a breakpoint pauses the
Blink loop, and Watch shows `blink_count`. The demo toggles LD2 every 500 ms.

After changing peripherals, regenerate in CubeMX and keep your application code
inside `USER CODE` sections. Clean and rebuild after changing the source/driver set.
Reconfigure after moving or renaming a project, updating CubeIDE, or changing
Makefile include paths, defines or CPU flags so IntelliSense is refreshed.

## Focus on USER CODE

Run **Dauhuniec: Focus on USER CODE** in a C/C++ file with CubeMX markers.
Generated sections collapse while user blocks, markers, function signatures and
braces stay visible. Use **Show Full File** to unfold everything, or
**Go to USER CODE Block** to jump to a named section. Editor title and status bar
buttons provide the same actions.

This feature works before build setup, including in IAR/EWARM exports, and leaves
source files unchanged. Per-file choices are remembered; enable
`dauhuniec.focusUserCodeOnOpen` for automatic focus (off by default). Incomplete
or mismatched markers prevent focus from being applied; if markers become invalid
in the active focused file, it is unfolded.

The same `main.c` before and after focusing. Generated initialization and helper
code fold away; USER CODE blocks and their function context stay visible.

| Full file | Focus on USER CODE |
| --- | --- |
| [![Full CubeMX-generated main.c](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-full.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-full.png) | [![The same main.c with generated sections folded](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-focus.png)](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/user-code-focus.png) |

## Serial monitor

Run **Dauhuniec: Open Serial Monitor**, select a port and baud rate, then use the
console in VS Code's Terminal panel. The port and speed are remembered. Type a
message and press Enter to send it; the connection uses 8N1 without flow control.

![Dauhuniec Serial Monitor receiving Blink messages from NUCLEO-F411RE at 115200 baud](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/serial-monitor.png)

The example receives real USART2 messages through the NUCLEO-F411RE's ST-LINK
virtual serial port at **115200 baud, 8N1**. Blink reports each LED toggle;
the port name is hidden in the screenshot.

| Console command | Action |
| --- | --- |
| `/hex`, `/text` | Switch received data between HEX and UTF-8. |
| `/ending lf`, `/ending crlf`, `/ending cr`, `/ending none` | Set the transmit line ending; LF is the default. |
| `/log PATH`, `/logoff` | Start or stop appending timestamped RX/TX records to a JSONL file. |
| `/clear` | Clear the terminal display. |
| `/help` | Show console help. |
| `/quit` or Ctrl+C | Disconnect and release the port. |

Use `//` to send a literal leading slash. Logging is off by default; the Command
Palette also provides **Serial Monitor: Start Logging** and **Stop Logging**.
Hiding the terminal keeps the connection and logging active. Only one serial
monitor terminal is managed per VS Code window; opening it again reveals the
existing session. Exit that session before selecting a different port or speed.
Serial monitoring works without configuring a firmware project or CubeIDE tools.

## MCU, board and offline documentation

Open **Resources → Documentation · MCU / Board / HAL / RTOS** or run
**Dauhuniec: Open Documentation (MCU / Board / HAL / RTOS)**. MCU and board links
come from the selected `.ioc`; build setup is not required.

MCU and ST board entries open product documentation pages in a browser for
datasheets, reference manuals, errata, board manuals and schematics. These pages
and PDFs opened from them are not cached by Dauhuniec. If the `.ioc` does not
identify the hardware, enter a supported STM32 MCU or ST board model manually.
Documentation for third-party boards can be opened locally.

HAL/LL manuals for families in the built-in catalog and catalogued RTOS PDFs
download when selected and are reused offline. **Update Downloaded Manual…**
refreshes a cached copy. FreeRTOS, CMSIS-RTOS and firmware package web references
open online. A family without a catalogued HAL/LL PDF needs manual or local lookup.

Local PDF, Markdown and HTML files appear in the same picker. Add directories
with `dauhuniec.documentationPaths`, or choose **Open Local Document…** for a
manual or schematic. Indexing is limited to 200 files per folder and excludes
common build and dependency directories. See the [official source catalog](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/docs/SOURCES.md).

![Documentation picker with MCU, board, HAL and RTOS references](https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/extension/media/screenshots/documentation.png)

## Project setup and compatibility

See [what changes and how to undo setup](#what-changes-in-your-project).

The build workflow supports standard **single-core STM32 MCU Makefile exports**
with literal `TARGET` and `BUILD_DIR` assignments. CMake, IAR/EWARM,
CubeIDE-managed builds, multi-core and STM32MP projects are not automatically converted.

| OS | Build | ST-LINK flash | Serial monitor | Automated CI |
| --- | --- | --- | --- | --- |
| macOS | Tested | Tested | Tested | Not currently enabled |
| Windows | Tested | Tested | Tested | Go and extension tests |
| Linux | Not hardware-validated | Not hardware-validated | Not hardware-validated | Go and extension tests |

Hardware results for macOS and Windows reflect maintainer testing, not CI.
Linux runtime and hardware validation are still pending; passing CI does not
verify USB devices. The macOS screenshots use a physical NUCLEO-F411RE;
NUCLEO-H723ZG was checked for probe discovery only.

Binaries are supplied for x64 and ARM64 on each platform. This availability does
not imply that every OS, architecture, board and probe combination has been tested.
On Windows ARM64, CubeIDE tools and USB drivers must also support your machine.

The extension requires a trusted workspace on a local filesystem; virtual
workspaces and browser-only VS Code are unsupported.
Local desktop development is the primary workflow. In SSH, WSL or containers,
tools and USB/serial access must be available on the workspace host. CubeMX also
needs a graphical session there.

## What changes in your project

| Location | What Dauhuniec writes |
| --- | --- |
| `.dauhuniec/` | Local `lon` executable, `tools.json`, selected probe in `target.json`, setup README, license and local ignore rules. Tool paths and probe selection belong to this computer. |
| `.dauhuniec/compile_commands.json` | Generated commands for clangd, with local compiler paths. Refreshed automatically; keep out of Git. |
| `.dauhuniec/backups/vscode-<timestamp>/` | A copy of the existing `.vscode/` directory before configuration, when it is nonempty. |
| `.vscode/` | Merged `settings.json`, `tasks.json`, `launch.json`, `c_cpp_properties.json` and `extensions.json`. Unrelated entries are preserved; updated JSON is reformatted and comments are removed. |
| `.gitignore` | Creates or updates a marked Dauhuniec block for the Makefile's build directory, local Dauhuniec and VS Code settings, serial recordings, logs and OS files. Rules outside the block are preserved. |
| `<BUILD_DIR>/<preset>/<flags-hash>/` | Compiler output for each configuration; **Clean Build** deletes the active configuration without invoking `make clean`. |
| Serial log path chosen by you | Timestamped RX/TX records appended when logging is enabled. |

**Dauhuniec setup does not rewrite `.ioc`, source files, drivers, linker scripts
or the Makefile.** USER CODE focus changes editor folding only. CubeMX code
regeneration remains a separate action: keep application logic inside its
`USER CODE` blocks. Builds invoke Make with the selected preset's debug,
optimization and extra flags, using the detected compiler and Make directories
on `PATH`. The CLI creates the complete output directory before invoking Make;
Windows builds use `cmd.exe`.

For Makefile projects without a root `CMakeLists.txt`, generated workspace settings
disable CMake auto-detection/configuration and STM32 CMake discovery prompts, so
CMSIS library CMake files do not take over the workspace. User tasks, unrelated
editor preferences and real root CMake configurations are preserved.

Downloaded official PDF manuals are stored in VS Code's extension global storage,
outside the firmware project. Serial port/speed and USER CODE focus choices are
kept in VS Code workspace state. Deleting `.dauhuniec/` does not reset these.

Keep machine-specific paths, probe selection, backups and build output out of Git.
Configure each teammate's checkout separately.

Setup maintains the block between `# BEGIN Dauhuniec (managed by lon setup)` and
`# END Dauhuniec` in `.gitignore`, refreshing `BUILD_DIR` when you configure again.
For an existing file, the block is inserted before your rules so later exceptions
such as `!serial-example.jsonl` keep their priority. Put custom rules outside the
block; only its contents are replaced. Existing line endings and file permissions
are preserved. Malformed or duplicate markers and symbolic links cause an error
without rewriting `.gitignore`.

Build and tool directories are ignored relative to the project root. Firmware
sources, `.ioc`, Makefile, drivers and linker scripts remain eligible for Git.
Serial rules cover `serial*.jsonl` and `*.log`; add your own rule for recordings
saved under other names. Ignore rules do not untrack files already committed.

Configure Project selects one clangd language server: `clangd.enable = true`,
`C_Cpp.intelliSenseEngine = "disabled"`, and `stm32cube-ide-clangd.enable = false`.
Semantic highlighting is enabled. Global editor settings stay unchanged and
previous workspace values are saved in the `.vscode/` backup.

Dauhuniec installs the official **clangd** extension if missing. It offers to
download the language server when no executable is available. To install or retry
later, run **Dauhuniec: Install / Update clangd** from the Command Palette or
Resources. An internet connection is needed for extension/server downloads;
after installation, navigation works offline. For an existing offline installation,
set `clangd.path` to its executable; Dauhuniec preserves that setting.

The CLI expands the Makefile's compiler recipes with Make's dry run and writes
`.dauhuniec/compile_commands.json`, including per-file flags and the selected
ARM GCC path. It refreshes the database during setup, before Build/Build + Flash,
and with `lon compdb`. VS Code also refreshes it when the project opens, Makefile
or `.mk` files change, or C/C++ source files are added or removed. The old database
is retained if generation fails; the Project panel reports refresh failures.
Custom Makefiles must expose C/C++ recipes through `$(CC)` or `$(CXX)`; compound
shell recipes and recursive builds are not supported by this database generator.

Open the project's own folder and allow the initial background index to finish.
Use **F12 / Go to Definition**, **Shift+F12 / Find All References**, and workspace
symbol search to navigate application code, HAL and CMSIS used by the build.
If language features remain inactive after migration, run **Developer: Reload
Window**. The Project panel detects a missing clangd extension and conflicting
language-server settings; exported diagnostics include their effective values.

### Undo setup

1. Stop debugging, active build tasks and the serial monitor.
2. **Before deleting `.dauhuniec/`**, copy the desired
   `.dauhuniec/backups/vscode-<timestamp>/` somewhere safe. Use the earliest backup
   to return to the state before the first configuration; review any later editor changes.
3. Restore that backup as `.vscode/`. If there was no previous editor configuration,
   remove only the files/entries created by Dauhuniec and keep any later additions.
4. Delete `.dauhuniec/`. Disable or uninstall Dauhuniec if you no longer want setup prompts.
5. Remove the marked Dauhuniec block from `.gitignore` if its rules are no longer needed;
   keep any custom rules outside it.

Firmware files need no restoration for changes made by Dauhuniec setup.

## Teamwork: VS Code and CubeIDE

Dauhuniec builds an existing **CubeMX Makefile export** and uses the compiler,
debugger and flashing tools from a local CubeIDE installation. Setup leaves the
`.ioc`, Makefile and firmware files unchanged. It does not import or synchronize
CubeIDE-managed build settings.

For a team using both editors, the suggested workflow is to share the firmware
and Makefile in Git and configure each checkout locally:

1. **Share a Makefile export.** Commit the `.ioc`, Makefile, linker script,
   sources, startup code, drivers and any required middleware. The project root
   must contain exactly one `.ioc` and a `Makefile`; the `.ioc` must retain
   **Toolchain / IDE = Makefile**. Agree on CubeMX, STM32Cube firmware package
   and ARM GCC versions.
2. **Configure VS Code locally.** Follow the quick start in each checkout.
   Dauhuniec discovers local tools and writes `.dauhuniec/` and `.vscode/`
   configuration. Keep machine-specific paths, probe selection, backups and
   build output out of Git; `.vscode/settings.json` also contains local paths.
3. **Configure CubeIDE manually.** Set up an external Make build against the
   same project-root Makefile, using local GNU Make and ARM GCC paths. Match
   Dauhuniec's `DEBUG=1 OPT=-Og` settings when comparing builds. CubeIDE project,
   build and debug configuration is maintained separately; Dauhuniec does not
   generate it. Verify that both editors build the shared Makefile before
   exchanging changes. A complete two-person CubeIDE round trip has not yet
   been validated.
4. **Share application changes.** Edit and commit the common sources from
   either editor. Keep application logic in `USER CODE` blocks in generated
   files, or in separate application files included in the build.
5. **Coordinate regeneration.** Let one teammate regenerate with CubeMX at a
   time, keeping **Toolchain / IDE = Makefile**. Review and commit the `.ioc`
   and generated changes together. After pulling, clean and rebuild; rerun
   **Configure Project** in VS Code when build inputs such as include paths,
   defines or the output target change.

Switching the `.ioc` generator to **STM32CubeIDE** makes the project fail
Dauhuniec's Makefile project check, even if an old Makefile remains. Restore
**Toolchain / IDE = Makefile** and regenerate before building with Dauhuniec.
Use separate checkouts and give each connected probe or serial port to one
application at a time.

## Limitations and FAQ

**Which project formats work?** Standard single-core STM32 MCU Makefile exports.
CMake, IAR/EWARM and CubeIDE-managed builds are not supported as the main build
workflow; multi-core MCUs and STM32MP projects are outside the supported scope.
USER CODE focus works independently, including in IAR exports.

**What if `TARGET` is not a literal?** Setup requires exactly one `TARGET` and
one `BUILD_DIR` assignment. For example:

```makefile
TARGET = Blink
BUILD_DIR = build
```

Computed values such as `TARGET = $(PROJECT_NAME)` are unsupported. Prefer a
fresh CubeMX **Makefile** export in a separate directory and move application
changes into it. If maintaining a custom Makefile, use literal values yourself:
`TARGET` accepts Latin letters, digits, underscores and hyphens; `BUILD_DIR` must
be a relative output directory using letters, digits, underscores, hyphens, dots
and `/`, without `.` or `..` path components or symlinks. Standard source and
configuration directories such as `Core`, `Drivers`, `Src` and `Inc` are rejected
as its first component; choose a dedicated output directory such as `build`. Dauhuniec
will not repair the Makefile for you.

| Problem | What to check |
| --- | --- |
| Toolchain or Make not found | Run **Check Environment**, use **Select CubeIDE Installation** / **Select GNU Make**, then **Configure CubeMX Project** again. Reconfigure after moving a project or updating CubeIDE. |
| ST-LINK missing | Use the board's ST-LINK connector and a data cable. Check the Windows driver or Linux udev rules, close other debuggers, then check **Target Board**. |
| Serial port busy | Close CubeIDE's console and other serial applications. Exit Dauhuniec's monitor with `/quit` or Ctrl+C; hiding its terminal keeps the port open. |
| Permission denied on `/dev/ttyACM*` | Check the port's owning group with `ls -l /dev/ttyACM*`. Grant your user access through your distribution's serial-device group (often `dialout`), then sign out and back in. ST-LINK USB udev rules and serial-port permissions are separate requirements. |
| Breakpoints do not match firmware | Clean, rebuild and restart debugging with the matching ELF. |

### Attach diagnostics to an issue

Run **Dauhuniec: Check Environment**, then copy its report from the **Dauhuniec**
Output channel (**Show Logs**). Alternatively, from a configured project root:

```sh
./.dauhuniec/lon doctor --json
```

On Windows: `.\.dauhuniec\lon.exe doctor --json`.
Include the report, OS/architecture, board/MCU, CubeIDE and CubeMX versions,
steps to reproduce and relevant build/flash/serial error output in an
[Issue](https://github.com/mikitabianko/Dauhuniec/issues).
Review paths, usernames and probe serial numbers before posting diagnostics.

## Dauhuniec and ST's official extension

| | Dauhuniec | STM32CubeIDE for VS Code |
| --- | --- | --- |
| Build workflow | Existing CubeMX Makefile export; no build-system conversion. | CMake projects and presets. |
| Getting started | Reuses tools from an installed desktop CubeIDE; configures local VS Code files. | ST's project creation/import and toolchain workflow. |
| Scope | Makefile setup, build/flash, Cortex-Debug integration, USER CODE folding and serial console. | ST's integrated STM32 development environment. |

Choose Dauhuniec when you want to keep a generated Makefile and use a small set
of everyday actions. Choose ST's extension when you want its CMake workflow.
See [ST's current project creation and import guide](https://dev.st.com/stm32cube-docs/stm32cubeide-vscode/latest/en/docs/markup/getting_started/first_project_creation.html)
for the official workflow. Dauhuniec is an independent project.

## Companion extensions

- [clangd](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd):
  semantic highlighting, completion and navigation using generated compilation commands.
- [Cortex-Debug](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug):
  runs Dauhuniec's debug configurations with GDB and the ST-LINK server.

Both are declared in Dauhuniec's extension pack; install them manually if missing.
The serial monitor is built in. Setup adds `svdFile` to the generated Debug and
Attach configurations when a matching SVD is found in CubeIDE. The sidebar/status
bar **Start Debugging** command creates its own configuration without `svdFile`;
use the generated Run and Debug configuration for this automatic SVD setup.
RTOS views are not configured.

## Roadmap

Ideas for future work, with no committed order or release dates:

- Pinout viewer based on the project's `.ioc`.
- RTOS Views integration for inspecting tasks during debugging.
- Broader SVD discovery and SVD setup for the **Start Debugging** command.
- CMake project support alongside the Makefile workflow.

Share use cases and help shape priorities in
[Issues](https://github.com/mikitabianko/Dauhuniec/issues).

## Upgrading from earlier names

Disable the old extension, install Dauhuniec and run **Configure CubeMX Project**
once per existing project. Setup migrates local `lon.*` and `codeready.*` settings
to `dauhuniec.*` and keeps the selected ST-LINK board. The old `.lon/` and
`.stm32-codeready/` directories remain available for rollback. Set global
extension preferences again under `dauhuniec.*`.

## Related search terms

Search phrases describing the workflow covered by this project:

- STM32 VS Code extension; STM32 development in Visual Studio Code.
- STM32CubeMX VSCode setup; CubeMX Makefile project in VS Code.
- STM32 build flash debug; ST-LINK debugging with Cortex-Debug.
- STM32 ARM GCC toolchain; arm-none-eabi-gcc Makefile build.
- STM32 serial monitor; UART terminal; ST-LINK virtual COM port.
- STM32 Nucleo VS Code; NUCLEO-F411RE development.
- STM32 VS Code Windows macOS Linux setup.

## Development and license

For manual installation, download the `.vsix` from the latest
[GitHub Release](https://github.com/mikitabianko/Dauhuniec/releases/latest), then
choose **Extensions → … → Install from VSIX…**. The same package includes all six
OS/architecture binaries.

See [CONTRIBUTING.md](https://github.com/mikitabianko/Dauhuniec/blob/master/CONTRIBUTING.md)
for source builds, tests and packaging. Go and Node.js are build-time requirements only.

Named after Belarusian **лён-даўгунец** (fibre flax); the native CLI is **`lon`**.
Dauhuniec is licensed under [MIT](https://github.com/mikitabianko/Dauhuniec/blob/master/LICENSE).
The package includes Go runtime and dependency license notices. Official manuals
remain subject to their publishers' terms.

Tool discovery now runs through `lon tools --json --diagnostics`, including CubeMX without a project. Invalid user paths offer discovered alternatives; managed paths recover automatically. Use **Dauhuniec: Export Diagnostic Report** to save a redacted support ZIP. See [discovery, recovery and report details](docs/tool-discovery.md).

## Build presets

Choose **Dauhuniec: Select Build Preset** or click the preset in the status bar.
Built-ins: `debug`, `release`, `size`, `relwithdebinfo`. Use
**Dauhuniec: Edit Build Presets** for custom compiler/linker flags and inheritance
in the project’s `dauhuniec.json`. Build, flash, debug and clangd share the preset;
outputs are isolated by preset and flags. CLI: `lon build --preset release`.
See the [build preset guide](https://github.com/mikitabianko/Dauhuniec/blob/master/docs/guide.md#build-presets-and-flags) for configuration and examples.
