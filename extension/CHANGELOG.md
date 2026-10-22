# Changelog

## 0.1.5

- Explicitly enable an already installed clangd extension before activation, including when VS Code exposes its manifest while globally disabled. Add an isolated recovery test covering HAL UART definitions, references and hover.

- Generate Makefile workspace defaults from a shared settings template: suppress automatic CMake/CMSIS discovery and configuration when no root CMake project exists, preserve language preferences and root CMake settings, pin CLI tasks to their workspace project, and include CMake settings in diagnostic exports. Create nested preset output directories before Make on every platform, including after Clean.

- Add configurable build presets (`debug`, `release`, `size`, `relwithdebinfo` and custom inheritance), a status-bar selector, `dauhuniec.json` editing with schema completion, CLI selection and `--preset`. Keep build, flash, debugger and clangd paths consistent; isolate outputs by preset and resolved flags.

- Use the official clangd language server for semantic highlighting, completion and code navigation. Install its extension during configuration and expose a server download/retry command. Generate a per-file compilation database from Make recipes, refresh it on configuration, builds and Make/source-list changes, and preserve the previous database on failure. Disable competing C/C++ and STM32 clangd engines locally; report installation, settings and database problems.

- Centralize cross-platform tool discovery in Go, including project-independent `lon tools --json`, CubeMX, per-action suitability, previous-installation recovery, numeric version selection and structured candidate diagnostics.
- Offer validated discovered alternatives for invalid explicit tool choices and preserve per-project picker history before validation, including after failures and workspace restarts.
- Add **Export Diagnostic Report** and failure-report actions, with bounded pre-failure logs and a redacted ZIP containing summary, structured metadata and available task/debug output.
- Include macOS in Go and extension CI matrices and cover recovery dialogs and Debug/Attach substitution in isolated Extension Hosts.

- Detect macOS CubeIDE bundles inside `/Applications/STMicroelectronics` and the user's `Applications` directory, including its `STMicroelectronics` subdirectory.

- Discover and validate the ST-LINK server after debug variable substitution when its configured path is empty, preventing a bare executable launch and reporting missing or non-executable server files before starting Cortex-Debug.

- Fix the Cortex-Debug `serverpath` setting in generated launch configurations and toolbar debugging. Automatically repair the old `serverPath` spelling when launching existing Dauhuniec Debug/Attach configurations.

- Maintain a marked project `.gitignore` block during setup, refresh the Makefile build directory, and preserve custom rules, exceptions and line endings. Reject malformed blocks and symbolic links without rewriting the file.

- Render the no-project Key Actions once through the tree provider to prevent repeated welcome controls after extension updates.

## 0.1.4

- Expand both READMEs with environment checks, project setup and rollback instructions, a shared Makefile workflow for VS Code and CubeIDE, and troubleshooting guidance.
- Clarify supported project formats, platform validation, remote workspace requirements, probe selection, serial monitor behavior and offline documentation caching.
- Add a screenshot overview, companion extension details, an official ST workflow comparison and a roadmap.
- Replace retired Marketplace badges with an installation badge and center the logo in both READMEs.

## 0.1.3

- Rework the READMEs around Marketplace installation, quick start and everyday workflows; update Windows testing status.
- Add screenshots of building, physical NUCLEO-F411RE debugging, target selection, USER CODE folding, serial monitoring and documentation, with personal paths and device identifiers hidden.

## 0.1.2

- Simplify Make discovery and extract build environment preparation and legacy settings migration without changing behavior.

## 0.1.1

- Use native GNU Make from CubeIDE on Windows without MSYS2; create build directories and clean them in the CLI, and include Windows setup instructions in Resources and the Command Palette.
- Validate manually selected tool paths, report selection failures and persist accepted paths in project settings.
- Add official CubeMX, CubeIDE and ST-LINK driver download links in Resources, setup and missing-CubeMX notifications.
- Publish verified release packages to Visual Studio Marketplace through GitHub Actions using Microsoft Entra OIDC.
- Remove the temporary Marketplace identity inspection workflow and redundant CLI build artifact.

## 0.1.0

Initial release of Dauhuniec, with the `lon` CLI.

- Configure CubeMX Makefile projects in VS Code with automatic tool discovery, environment checks, and a project sidebar.
- Build, flash, and debug through native tasks and Cortex-Debug; preserve existing VS Code settings with backups.
- Bundle native CLIs for Windows, macOS, and Linux on x86_64 and ARM64.
- Select and remember target boards by ST-LINK serial number for flashing and debugging.
- Open existing projects in standalone STM32CubeMX or launch it to create a project.
- Focus on USER CODE blocks while preserving function signatures, navigate between blocks, and restore the full file without changing source text.
- Provide status bar actions for project selection, building, flashing, debugging, configuration, and task cancellation.
- Run a native serial console with port and baud rate selection, text/HEX display, line ending controls, and optional RX/TX JSONL logging.
- Open official MCU, board, HAL/LL, FreeRTOS, and CMSIS-RTOS documentation, cache publisher PDFs for offline use, and browse local documents.
- Store project state in `.dauhuniec/` and migrate settings from earlier development versions.
- Use pnpm for extension development and distribute the project's own code under the MIT License.
