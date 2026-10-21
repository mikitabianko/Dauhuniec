# Changelog

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
