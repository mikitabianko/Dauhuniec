# Dauhuniec

<img src="https://raw.githubusercontent.com/mikitabianko/Dauhuniec/master/assets/logo.png" alt="Dauhuniec flax flower" width="160">

**Build, flash and debug STM32CubeMX projects in VS Code.**

Keep CubeMX for pins, clocks and code generation. Dauhuniec brings guided setup,
ST-LINK flashing, Cortex-Debug integration and a serial monitor to your VS Code
workspace, using the tools from your STM32CubeIDE installation.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec) ·
[Quick start](#quick-start) ·
[User guide](https://github.com/mikitabianko/Dauhuniec/blob/master/docs/guide.md) ·
[Changelog](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/CHANGELOG.md) ·
[Report an issue](https://github.com/mikitabianko/Dauhuniec/issues)

![Dauhuniec sidebar and a successful Blink firmware build](media/screenshots/build.png)

## Features

- **Guided project setup** — detect CubeIDE tools, configure build tasks, IntelliSense and debugging.
- **Build, flash and debug** — run actions from the sidebar, status bar or Command Palette.
- **ST-LINK target selection** — choose a board by serial number and remember it per project.
- **USER CODE focus** — fold generated sections while keeping editable blocks and their function context visible.
- **Serial monitor** — send and receive data in the terminal, switch UTF-8/HEX display and record RX/TX logs.
- **Documentation at hand** — find MCU, board, HAL/LL and RTOS references, download official PDFs for offline reuse and open local documents.
- **Bundled native CLI** — use `lon` inside or outside VS Code on Windows, macOS and Linux, on x64 or ARM64.

## Installation

Install **[Dauhuniec from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=dauhuniec.dauhuniec)**,
or search for **Dauhuniec** in the Extensions view. From a terminal:

```sh
code --install-extension dauhuniec.dauhuniec
```

Requires **VS Code 1.95 or later**. C/C++ and Cortex-Debug are declared as companion
extensions; install them manually if missing. The native CLI is included, so
extension users do not need Go, Python or a separate Node.js installation.

For manual installation, download the `.vsix` from the latest
[GitHub Release](https://github.com/mikitabianko/Dauhuniec/releases/latest), then
choose **Extensions → … → Install from VSIX…**. The same package includes all six
OS/architecture binaries.

## Required tools

| Tool | Purpose |
| --- | --- |
| [STM32CubeMX](https://www.st.com/en/development-tools/stm32cubemx.html) | Configure the MCU and generate a **Makefile** project. |
| [STM32CubeIDE](https://www.st.com/en/development-tools/stm32cubeide.html) | Provides ARM GCC, GDB, ST-LINK GDB server and STM32CubeProgrammer. You can use these tools without opening the project in CubeIDE. |
| GNU Make | Builds the generated Makefile. |
| STM32 board and ST-LINK | Required for flashing and debugging; an onboard ST-LINK is sufficient. |

- **Windows:** native Make is detected inside CubeIDE. Install the [ST-LINK USB driver](https://www.st.com/en/development-tools/stsw-link009.html) as needed. Follow the [Windows setup guide](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/docs/windows.md).
- **macOS:** install Command Line Tools with `xcode-select --install` to provide Make.
- **Linux:** install `make` through your package manager and the ST-LINK udev rules supplied with CubeIDE. Ensure your user can access the USB device.

Open **Resources → Install Tools / Official Downloads** in the sidebar for official
download links. The serial monitor additionally needs an accessible serial port
and any required USB-to-serial driver.

## Quick start

1. Create or open a project in **STM32CubeMX**. The command
   **Dauhuniec: Open in STM32CubeMX / Create Project** launches CubeMX for you.
2. Under **Project Manager → Project → Toolchain / IDE**, select **Makefile**
   and generate code.
3. Open the generated project folder in VS Code, with one `.ioc` file and the
   `Makefile` at its root.
4. Open **Dauhuniec** in the activity bar and choose **Configure Project**, or run
   **Dauhuniec: Configure CubeMX Project**. Select CubeIDE or Make if prompted.
5. Run **Dauhuniec: Build**.
6. Connect the board's ST-LINK USB connector with a data-capable cable. Check
   **Project → Target Board**, then choose **Build, Flash and Run** or **Start Debugging**.

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
| **Dauhuniec: Check Environment** | Check project configuration and required tools. |

The status bar provides shortcuts for Home, CubeMX, Build, Flash, Build and Flash,
Debug and Serial Monitor. Hover over an icon for its action. **Stop** appears
while a cancellable task is running. Compiler diagnostics appear in Problems.

For F5, select **Dauhuniec: Debug** in Run and Debug. Existing default build tasks
are preserved; select **Dauhuniec: Build** explicitly if another task is the default.

Use **Project → Target Board** or **Dauhuniec: Select Target Board** to choose a
probe by ST-LINK serial number. A single connected probe is selected automatically.
The choice is remembered per project in `.dauhuniec/target.json`. If that probe is
disconnected, flashing and debugging wait for it or for you to choose another target.
The serial monitor's port is selected separately.

![Selecting NUCLEO-F411RE with NUCLEO-H723ZG also connected; ST-LINK serials are hidden](media/screenshots/target-board.png)

ST-LINK serial numbers are hidden in these screenshots. Dauhuniec displays the
full numbers during normal use so identical boards can be distinguished.

![Cortex-Debug paused in the NUCLEO-F411RE Blink loop with blink_count in Watch](media/screenshots/debug.png)

The debugging example runs on a physical NUCLEO-F411RE: a breakpoint pauses the
Blink loop, and Watch shows `blink_count`. The demo toggles LD2 every 500 ms.

After changing peripherals, regenerate in CubeMX and keep your application code
inside `USER CODE` sections. Clean and rebuild after changing the source/driver set.
Reconfigure after moving or renaming a project or updating CubeIDE.

## Focus on USER CODE

Run **Dauhuniec: Focus on USER CODE** in a C/C++ file with CubeMX markers.
Generated sections collapse while user blocks, markers, function signatures and
braces stay visible. Use **Show Full File** to unfold everything, or
**Go to USER CODE Block** to jump to a named section. Editor title and status bar
buttons provide the same actions.

This feature works before build setup, including in IAR/EWARM exports, and leaves
source files unchanged. Per-file choices are remembered; enable
`dauhuniec.focusUserCodeOnOpen` for automatic focus (off by default). Incomplete
or mismatched markers reveal the full file.

The same `main.c` before and after focusing. Generated initialization and helper
code fold away; USER CODE blocks and their function context stay visible.

| Full file | Focus on USER CODE |
| --- | --- |
| [![Full CubeMX-generated main.c](media/screenshots/user-code-full.png)](media/screenshots/user-code-full.png) | [![The same main.c with generated sections folded](media/screenshots/user-code-focus.png)](media/screenshots/user-code-focus.png) |

## Serial monitor

Run **Dauhuniec: Open Serial Monitor**, select a port and baud rate, then use the
console in VS Code's Terminal panel. The port and speed are remembered. Type a
message and press Enter to send it; the connection uses 8N1 without flow control.

![Dauhuniec Serial Monitor receiving Blink messages from NUCLEO-F411RE at 115200 baud](media/screenshots/serial-monitor.png)

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
Hiding the terminal keeps the connection and logging active.

## MCU, board and offline documentation

Open **Resources → Documentation · MCU / Board / HAL / RTOS** or run
**Dauhuniec: Open Documentation (MCU / Board / HAL / RTOS)**. MCU and board links
come from the selected `.ioc`; build setup is not required.

Find ST datasheets, reference manuals, errata, board manuals and schematics,
family-specific HAL/LL manuals, FreeRTOS documentation and CMSIS-RTOS references.
PDFs download when selected and are reused offline. **Update Downloaded Manual…**
refreshes a cached copy. HTML references open online.

Local PDF, Markdown and HTML files appear in the same picker. Add directories
with `dauhuniec.documentationPaths`, or choose **Open Local Document…** for a
manual or schematic. See the [official source catalog](https://github.com/mikitabianko/Dauhuniec/blob/master/extension/docs/SOURCES.md).

![Documentation picker with MCU, board, HAL and RTOS references](media/screenshots/documentation.png)

## Project setup and compatibility

Setup adds a project-local CLI and tool paths under `.dauhuniec/` and merges
managed tasks, debug configurations, compiler settings and extension
recommendations into `.vscode/`. Existing editor files are backed up and unrelated
entries are preserved. Sources, drivers, `.ioc`, linker script and Makefile stay
unchanged. Builds use `DEBUG=1 OPT=-Og`.

The build workflow supports standard **single-core STM32 MCU Makefile exports**
with literal `TARGET` and `BUILD_DIR` assignments. CMake, IAR/EWARM,
CubeIDE-managed builds, multi-core and STM32MP projects are not automatically converted.

**Tested on Windows and macOS.** Linux binaries are supplied; Linux runtime and
hardware verification are still needed. Binaries are available for x64 and ARM64
on each platform; this does not imply testing of every architecture, board or
probe combination. Windows ARM64 also needs compatible CubeIDE tools and USB drivers.

Local desktop development is the primary workflow. In SSH, WSL or containers,
tools and USB/serial access must be available on the workspace host. CubeMX also
needs a graphical session there.

## Help

- **Tools not found:** run **Check Environment**, select the CubeIDE installation or Make executable, then reconfigure.
- **CubeMX not found:** set `dauhuniec.cubeMXPath` to its executable, installation directory or macOS `.app`.
- **ST-LINK not found:** check the USB cable, driver/udev rules, other debuggers and **Target Board**.
- **Breakpoints do not match:** clean and rebuild, then restart debugging.
- **Serial port busy:** close other serial applications or exit the console with `/quit` or Ctrl+C.

Read the [user guide](https://github.com/mikitabianko/Dauhuniec/blob/master/docs/guide.md)
for detailed workflows and standalone CLI usage. To
[report a problem](https://github.com/mikitabianko/Dauhuniec/issues), include your
OS, tool versions and relevant output from **Dauhuniec: Show Logs**.

### Upgrading from earlier names

Disable the old extension, install Dauhuniec and run **Configure CubeMX Project**
once per existing project. Setup migrates local `lon.*` and `codeready.*` settings
to `dauhuniec.*` and keeps the selected ST-LINK board. The old `.lon/` and
`.stm32-codeready/` directories remain available for rollback. Set global
extension preferences again under `dauhuniec.*`.

## Development and license

See [CONTRIBUTING.md](https://github.com/mikitabianko/Dauhuniec/blob/master/CONTRIBUTING.md)
for source builds, tests and packaging. Go and Node.js are build-time requirements only.

Named after Belarusian **лён-даўгунец** (fibre flax); the native CLI is **`lon`**.
Dauhuniec is licensed under [MIT](https://github.com/mikitabianko/Dauhuniec/blob/master/LICENSE).
The package includes Go runtime and dependency license notices. Official manuals
remain subject to their publishers' terms.
