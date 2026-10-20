# Dauhuniec

<img src="assets/logo.png" alt="Dauhuniec flax flower" width="160">

**Keep CubeMX for code generation. Use VS Code for development.**

Dauhuniec takes an STM32CubeMX **Makefile** project into VS Code with tool
detection, build tasks, ST-LINK flashing and Cortex-Debug integration.
Its native CLI, **`lon`**, is bundled with the extension and can also run independently.

[Prerequisites](#prerequisites) · [Installation](#installation) ·
[Quick start](#quick-start) · [CLI](#cli) · [Help](#help)

## Features

- **Build, flash and debug** from the sidebar, status bar or Command Palette.
- **Select an ST-LINK target** by serial number when working with multiple boards.
- **Focus on USER CODE** by folding CubeMX-generated sections without changing files.
- **Use the serial console** with UTF-8/HEX display, configurable line endings and optional RX/TX logging.
- **Find documentation** for your MCU, board, HAL/LL and RTOS; download official PDF manuals for offline reuse or open local documents.

## Prerequisites

For the build, flash and debug workflow, install:

| Requirement | Purpose |
| --- | --- |
| **VS Code 1.95 or later** | Runs the Dauhuniec extension. |
| **STM32CubeMX** | Generates a project with **Toolchain / IDE → Makefile**. |
| **STM32CubeIDE** | Supplies ARM GCC, GDB, ST-LINK GDB server and STM32CubeProgrammer. You can use these tools without opening your project in CubeIDE. |
| **GNU Make** | Builds the generated Makefile project. See platform notes below. |
| **C/C++** (`ms-vscode.cpptools`) and **Cortex-Debug** (`marus25.cortex-debug`) extensions | Provide C/C++ language support and debugging. They are declared as companion extensions; install them manually if missing. |
| **STM32 board and ST-LINK probe** | Required for flashing and debugging. An onboard ST-LINK is sufficient; use a data-capable USB cable. |

Platform setup:

- **Windows:** Make is detected automatically inside STM32CubeIDE. No separate
  build environment or shell installation is needed. Install ST's ST-LINK USB driver.
- **macOS:** install Command Line Tools with `xcode-select --install` to provide Make.
- **Linux:** install `make` through your package manager and the ST-LINK udev rules
  supplied with CubeIDE. Ensure your user has access to the USB device.

The serial console additionally needs an accessible serial port and any required
USB-to-serial driver. Packaged extension users do not need Go, Node.js or Python.

## Installation

**VS Code Marketplace publication is planned.** Until the extension is published,
install a VSIX package or build one from source.

Download the `.vsix` installer from the latest
[GitHub Release](https://github.com/mikitabianko/Dauhuniec/releases/latest), then
use **Extensions → … → Install from VSIX…** in VS Code. One installer includes
the CLI for Windows, macOS and Linux on x64 and ARM64.

Pull requests targeting `master` show CLI and extension test results under **Checks**.
Installer builds and releases run automatically after those pull requests are merged.
To download a build artifact, open [Release extension in GitHub Actions](https://github.com/mikitabianko/Dauhuniec/actions/workflows/release-extension.yml),
select a successful run and download `dauhuniec-<version>-vsix` under **Artifacts**.
Sign in to GitHub to download the artifact, then unzip it to get the `.vsix` and
its `SHA256SUMS` file. Build artifacts are retained for 30 days; tagged releases
provide lasting downloads. If no build has run yet, use the source build below.

<details>
<summary>Build the extension from source</summary>

You need **Git**, **Go 1.22 or later**, and **Node.js 20 or later with pnpm 10**.
These are build-time requirements for Dauhuniec itself, in addition to the tools
needed for firmware development.

```sh
git clone https://github.com/mikitabianko/Dauhuniec.git
cd Dauhuniec
go test ./...
go run ./cmd/package
cd extension
pnpm install --frozen-lockfile
pnpm test
pnpm run package
```

Install the resulting `releases/dauhuniec-0.1.2.vsix` from the repository root.
The build also produces six native CLI executables in `bin/` and a `SHA256SUMS`
file. These outputs are excluded from source control.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and packaging details.

</details>

## Quick start

1. Open or create your project in **STM32CubeMX**. Under
   **Project Manager → Project → Toolchain / IDE**, select **Makefile** and generate code.
2. Open the generated project folder in VS Code. Its root should contain one
   `.ioc` file and the generated `Makefile`.
3. Open **Dauhuniec** in the activity bar and choose **Configure Project**, or run
   **Dauhuniec: Configure CubeMX Project** from the Command Palette.
   If detection needs help, select your CubeIDE installation or Make executable.
4. Run **Dauhuniec: Build** to compile the firmware.
5. Connect ST-LINK and use **Project → Target Board** to select your target,
   especially when more than one probe is connected.
6. Choose the action you need:

| Command Palette action | Behavior |
| --- | --- |
| **Dauhuniec: Build** | Compile without flashing. |
| **Dauhuniec: Flash Firmware (Without Building)** | Flash the existing ELF and run it. |
| **Dauhuniec: Build, Flash and Run** | Build, flash and run the firmware. |
| **Dauhuniec: Start Debugging** | Build and launch Cortex-Debug. |

The status bar provides shortcuts for these actions; hover over an icon to see
its action. For F5 debugging, select **Dauhuniec: Debug** in Run and Debug.

Setup adds project-local tools and settings under `.dauhuniec/` and merges editor
configuration into `.vscode/`, backing up existing editor files. Firmware sources,
the `.ioc`, linker script and Makefile stay unchanged. Keep application code in
CubeMX's `USER CODE` sections when regenerating.

## CLI

The optional `lon` CLI supports setup, environment checks, builds, flashing and
serial communication outside the extension. After configuring a firmware project,
run its local copy from that project's root:

```sh
./.dauhuniec/lon doctor
./.dauhuniec/lon build
./.dauhuniec/lon serial-console --port /dev/cu.usbmodem144203 --baud 115200
```

On Windows, use `.\.dauhuniec\lon.exe` and a port such as `COM3`; Linux ports often
look like `/dev/ttyACM0`. Run `--help` for the command list.

For initial setup without the extension, build the native executables using the
source instructions above, then run `sh setup.sh /path/to/firmware` on macOS/Linux
or `setup.cmd C:\path\to\firmware` on Windows from the repository root.

Adding a standalone `lon` executable to **PATH is optional**. The extension and
generated project tasks use their own executable paths and do not require it.

## Compatibility

Dauhuniec supports standard **single-core STM32 MCU Makefile exports**, with
literal `TARGET` and `BUILD_DIR` assignments. CMake, IAR/EWARM, CubeIDE-managed
builds, multi-core and STM32MP projects are not automatically converted.

Native binaries build for **macOS, Windows and Linux**, on **x86_64 and ARM64**.
Personal testing has so far been on **macOS**. Windows/Linux runtime behavior and
hardware flashing, debugging and serial communication on each platform still
need verification.

For SSH, WSL or containers, native tools and USB/serial devices must be accessible
on the workspace host. Local desktop development is the primary workflow.

## Help

- **Tools not found:** run **Dauhuniec: Check Environment**, then select the
  CubeIDE installation or GNU Make executable. Reconfigure after moving the
  project or updating CubeIDE.
- **ST-LINK not found:** check the cable, USB driver or udev rules, close other
  debuggers, and check **Target Board**.
- **No ELF or stale breakpoints:** build first; clean and rebuild after changes
  to generated sources or drivers.
- **Serial port busy:** stop other serial applications; use `/quit` or Ctrl+C to
  release a port held by Dauhuniec's console.

Read the [user guide](docs/guide.md) or the
[extension guide](extension/README.md) for detailed usage, settings and serial commands.
See the [changelog](extension/CHANGELOG.md) and
[documentation sources](extension/docs/SOURCES.md), or
[report an issue](https://github.com/mikitabianko/Dauhuniec/issues) with your OS,
tool versions and relevant logs.

## Licenses

The project's own code is licensed under the [MIT License](LICENSE).
[GO-LICENSE.txt](GO-LICENSE.txt) covers the Go runtime;
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) contains Go dependency notices.
Official manuals remain subject to their publishers' terms.
