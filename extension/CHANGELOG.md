# Changelog

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
