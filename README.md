# Dauhuniec

**STM32 in VS Code: CubeMX → build → flash → debug, without rewriting your firmware project.**

<p align="center">
  <img src="assets/logo.png" alt="Dauhuniec flax flower" width="160">
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
[Quick start](#quick-start) · [User guide](docs/guide.md) ·
[Changelog](extension/CHANGELOG.md) ·
[Report an issue](https://github.com/mikitabianko/Dauhuniec/issues)

| Build firmware | Select a target board |
| --- | --- |
| [![Successful Blink firmware build](extension/media/screenshots/build.png)](extension/media/screenshots/build.png) | [![ST-LINK target selection](extension/media/screenshots/target-board.png)](extension/media/screenshots/target-board.png) |
| **Serial monitor** | **Focus on USER CODE** |
| [![Serial data from NUCLEO-F411RE](extension/media/screenshots/serial-monitor.png)](extension/media/screenshots/serial-monitor.png) | [![Generated code folded around USER CODE blocks](extension/media/screenshots/user-code-focus.png)](extension/media/screenshots/user-code-focus.png) |

## Features

- **Configure your project** with automatic discovery of CubeIDE tools and ready-to-use build, debug and IntelliSense settings.
- **Build, flash and debug** from the sidebar, status bar or Command Palette.
- **Choose your target** by ST-LINK serial number when several boards are connected.
- **Focus on USER CODE** by folding generated sections while keeping function context visible.
- **Monitor serial data** in the terminal with UTF-8/HEX display, configurable line endings and optional RX/TX logging.
- **Find MCU, board, HAL/LL and RTOS documentation**, cache catalogued HAL/LL and RTOS PDFs for offline reading and open local schematics.
- **Use the bundled `lon` CLI** for setup, builds, flashing and serial communication outside VS Code.

## Installation

Install **[Dauhuniec from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec)**,
or search for **Dauhuniec** in VS Code's Extensions view. You can also run:

```sh
code --install-extension dauhuniec.dauhuniec
```

Requires **VS Code 1.95 or later**. C/C++ and Cortex-Debug are declared as companion
extensions; install them manually if missing. Native CLI binaries are bundled for
Windows, macOS and Linux on x64 and ARM64. Extension users do not need Go, Python
or a separate Node.js installation.

## Required tools

| Tool | Purpose |
| --- | --- |
| [STM32CubeMX](https://www.st.com/en/development-tools/stm32cubemx.html) | Configure the MCU and generate a **Makefile** project. |
| [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) | Supplies ARM GCC, GDB, ST-LINK GDB server and STM32CubeProgrammer. Dauhuniec uses these tools directly. |
| GNU Make | Builds the generated project; see platform setup below. |
| STM32 board with ST-LINK | Needed for flashing and debugging. An onboard probe and a data-capable USB cable are sufficient. |

- **Windows:** Make is detected inside CubeIDE. Install the [ST-LINK USB driver](https://www.st.com/en/development-tools/stsw-link009.html) as needed. See the [Windows setup guide](extension/docs/windows.md).
- **macOS:** install Command Line Tools with `xcode-select --install` to provide Make.
- **Linux:** install `make` through your package manager and [CubeIDE's ST-LINK udev rules](https://www.st.com/resource/en/user_manual/um2563-stm32cubeide-installation-guide-stmicroelectronics.pdf); ensure your user can access the device.

Official download links are also available through **Dauhuniec: Install Tools / Official Downloads**.
The serial monitor additionally needs an accessible serial port and any required
USB-to-serial driver.

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

![Cortex-Debug paused in the NUCLEO-F411RE Blink loop](extension/media/screenshots/debug.png)

The example runs on a physical **NUCLEO-F411RE**. ST-LINK serial numbers are
hidden in the screenshots.

For F5 debugging, select **Dauhuniec: Debug** in Run and Debug. The status bar
also provides shortcuts for CubeMX, building, flashing, debugging and the serial monitor.
Setup also creates **Dauhuniec: Attach** to connect to running firmware without a
pre-launch build, using the configured ELF for symbols. Existing default build
tasks are preserved; select **Dauhuniec: Build** explicitly if another task is the default.

Setup adds local tools under `.dauhuniec/` and merges editor configuration into
`.vscode/`, backing up existing editor files. Firmware sources, the `.ioc`, linker
script and Makefile stay unchanged. Keep application code in CubeMX's `USER CODE`
sections when regenerating; clean and rebuild after changing the source/driver set.
Rerun **Configure CubeMX Project** after changes to Makefile include paths, defines
or CPU flags to refresh IntelliSense, or after moving the project or updating CubeIDE.

## Select a target board

Open **Project → Target Board** to choose the board that receives firmware.
Dauhuniec remembers its ST-LINK serial number per project. The example shows
NUCLEO-F411RE selected while NUCLEO-H723ZG is also connected; serial numbers are
hidden in the image.

A single connected probe is selected automatically. If the remembered probe is
disconnected, flashing and debugging report an error. Reconnect it or select
another target, then retry. The serial monitor's port is selected separately.

![Selecting NUCLEO-F411RE with two Nucleo boards connected](extension/media/screenshots/target-board.png)

## Focus on USER CODE

Run **Dauhuniec: Focus on USER CODE** or use the editor title button to hide
generated sections. **Show Full File** restores the complete view. This changes
editor folding only; your source files and CubeMX regeneration stay unchanged.

The same `main.c` before and after focusing. Generated initialization and helper
code fold away; USER CODE blocks and their function context stay visible.

| Full file | Focus on USER CODE |
| --- | --- |
| [![Full CubeMX-generated main.c](extension/media/screenshots/user-code-full.png)](extension/media/screenshots/user-code-full.png) | [![The same main.c with generated sections folded](extension/media/screenshots/user-code-focus.png)](extension/media/screenshots/user-code-focus.png) |

## Serial monitor

Run **Dauhuniec: Open Serial Monitor**, choose your board's port and baud rate,
and read incoming data in VS Code's Terminal panel. Type a message and press Enter
to send it. Use `/hex` and `/text` to switch the receive display, `/log PATH` to
record RX/TX, and `/quit` or Ctrl+C to disconnect.

![Serial Monitor receiving real Blink messages from NUCLEO-F411RE](extension/media/screenshots/serial-monitor.png)

This example receives USART2 messages through the F411RE's ST-LINK virtual serial
port at **115200 baud, 8N1**. The port name is hidden. See the
[Serial Monitor guide](extension/README.md#serial-monitor) for console commands.

## Documentation

Open **Resources → Documentation · MCU / Board / HAL / RTOS** to find references
for the MCU and board in your `.ioc`, HAL/LL manuals and RTOS documentation.
HAL/LL and RTOS PDFs from the built-in catalog are downloaded on demand and
reused offline. MCU/board entries open ST product documentation pages in a browser;
PDFs opened from those pages are not cached by Dauhuniec. Local manuals and
schematics appear in the same picker.

![MCU, board, HAL and RTOS documentation for the F411RE demo](extension/media/screenshots/documentation.png)

## What changes in your project

| Location | What Dauhuniec writes |
| --- | --- |
| `.dauhuniec/` | Local `lon` executable, `tools.json`, selected probe in `target.json`, setup README, license and local ignore rules. Tool paths and probe selection belong to this computer. |
| `.dauhuniec/backups/vscode-<timestamp>/` | A copy of the existing `.vscode/` directory before configuration, when it is nonempty. |
| `.vscode/` | Merged `settings.json`, `tasks.json`, `launch.json`, `c_cpp_properties.json` and `extensions.json`. Unrelated entries are preserved; updated JSON is reformatted and comments are removed. |
| Makefile's `BUILD_DIR` (usually `build/`) | Compiler output during builds; **Clean Build** deletes this directory without invoking `make clean`. |
| Serial log path chosen by you | Timestamped RX/TX records appended when logging is enabled. |

**Dauhuniec setup does not rewrite `.ioc`, source files, drivers, linker scripts
or the Makefile.** USER CODE focus changes editor folding only. CubeMX code
regeneration remains a separate action: keep application logic inside its
`USER CODE` blocks. Builds invoke `make -j2 GCC_PATH= PREFIX=arm-none-eabi- DEBUG=1 OPT=-Og all`,
using the detected compiler and Make directories on `PATH`. Windows builds use
`cmd.exe`; the CLI creates the output directory before invoking Make.

Downloaded official PDF manuals are stored in VS Code's extension global storage,
outside the firmware project. Serial port/speed and USER CODE focus choices are
kept in VS Code workspace state. Deleting `.dauhuniec/` does not reset these.

Keep machine-specific paths, probe selection, backups and build output out of Git.
Configure each teammate's checkout separately.

### Undo setup

1. Stop debugging, active build tasks and the serial monitor.
2. **Before deleting `.dauhuniec/`**, copy the desired
   `.dauhuniec/backups/vscode-<timestamp>/` somewhere safe. Use the earliest backup
   to return to the state before the first configuration; review any later editor changes.
3. Restore that backup as `.vscode/`. If there was no previous editor configuration,
   remove only the files/entries created by Dauhuniec and keep any later additions.
4. Delete `.dauhuniec/`. Disable or uninstall Dauhuniec if you no longer want setup prompts.

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

## Compatibility

The build workflow supports standard **single-core STM32 MCU Makefile exports**
with literal `TARGET` and `BUILD_DIR` assignments. CMake, IAR/EWARM,
CubeIDE-managed builds, multi-core and STM32MP projects are not automatically
converted. USER CODE focus also works independently of build setup.

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
Local desktop development is the primary workflow. For SSH, WSL or containers,
tools and USB/serial devices must be accessible on the workspace host.
CubeMX also needs a graphical session there.

## CLI

The bundled native CLI is called **`lon`**, from Belarusian **лён-даўгунец**
(fibre flax), the source of the Dauhuniec name. After configuring a firmware
project, run its local copy from that project's root:

```sh
./.dauhuniec/lon doctor
./.dauhuniec/lon build
./.dauhuniec/lon serial-console --port /dev/cu.usbmodem144203 --baud 115200
```

On Windows, use `.\.dauhuniec\lon.exe` and a port such as `COM3`; Linux ports often
look like `/dev/ttyACM0`. Run `--help` for all commands. Adding `lon` to PATH is optional.
See the [CLI guide](docs/guide.md#cli-without-the-extension) for standalone setup.

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

- [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools):
  IntelliSense and code navigation using the generated compiler configuration.
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

## Contributing and manual installation

For manual installation, download the `.vsix` from the latest
[GitHub Release](https://github.com/mikitabianko/Dauhuniec/releases/latest) and
choose **Extensions → … → Install from VSIX…**. One installer includes all six
CLI binaries.

See [CONTRIBUTING.md](CONTRIBUTING.md) for source builds, tests and packaging,
[Changelog](extension/CHANGELOG.md) for releases and [Issues](https://github.com/mikitabianko/Dauhuniec/issues)
for bugs and feature requests. See [release administration](docs/releasing.md) for publishing.

## Related search terms

Search phrases describing the workflow covered by this project:

- STM32 VS Code extension; STM32 development in Visual Studio Code.
- STM32CubeMX VSCode setup; CubeMX Makefile project in VS Code.
- STM32 build flash debug; ST-LINK debugging with Cortex-Debug.
- STM32 ARM GCC toolchain; arm-none-eabi-gcc Makefile build.
- STM32 serial monitor; UART terminal; ST-LINK virtual COM port.
- STM32 Nucleo VS Code; NUCLEO-F411RE development.
- STM32 VS Code Windows macOS Linux setup.

## License

[MIT](LICENSE). [GO-LICENSE.txt](GO-LICENSE.txt) covers the Go runtime;
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) lists dependency notices.
Official manuals remain subject to their publishers' terms.
