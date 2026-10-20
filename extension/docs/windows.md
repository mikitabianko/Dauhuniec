# Windows setup without MSYS2

1. Install the desktop STM32CubeIDE from the [official ST page](https://www.st.com/en/development-tools/stm32cubeide.html).
   Keep the complete installation: Dauhuniec uses its ARM GCC, GDB, native GNU Make,
   ST-LINK server and CubeProgrammer without opening the IDE.
2. Install standalone [STM32CubeMX](https://www.st.com/en/development-tools/stm32cubemx.html)
   and generate your project with **Toolchain / IDE = Makefile**.
3. Install the [ST-LINK USB driver](https://www.st.com/en/development-tools/stsw-link009.html)
   if needed for your probe.
4. Open the generated project folder in regular Windows VS Code and run
   **Dauhuniec: Configure CubeMX Project**. If prompted, select your CubeIDE
   installation or its `plugins` directory.
5. Run **Build Firmware**, then select your board before flashing or debugging.

No MSYS2, pacman, Git Bash, WSL, CMake or separately installed Make is required.
You do not need to add CubeIDE tools to the system PATH. Dauhuniec uses native
Make from `plugins/com.st.stm32cube.ide.mcu.externaltools.make.*/tools/bin/make.exe`
and the built-in Windows command interpreter.

## Existing projects

Run **Configure CubeMX Project** again to replace the saved MSYS2 tool paths
and update the project-local CLI. If you previously set `dauhuniec.makePath`
in workspace settings, clear that override to enable automatic discovery.
The CLI similarly supports `lon setup --cube-ide <installation>`.

## Troubleshooting

- **Native GNU Make not found:** select the complete CubeIDE installation,
  rather than a standalone compiler or CubeMX. Check that its Make plugin
  contains `tools/bin/make.exe`. A manual native Make override remains available
  through **Select GNU Make** or `dauhuniec.makePath`.
- **Old shell configuration:** rerun Configure Project to update the CLI,
  `tools.json` and VS Code settings; the old shell setting is removed.
- **Custom Makefile recipes:** the standard CubeMX Makefile is supported without
  modification. Build directories are created by Dauhuniec, and Clean removes
  them directly. Added recipes that use Unix utilities still need to be adapted
  to Windows commands.
- **Windows ARM64:** check that the installed CubeIDE tools and USB driver can
  run on your machine; the bundled ARM64 CLI does not change their requirements.

Reopen this page through **Resources → Windows Setup Instructions** or
**Dauhuniec: Windows Setup Instructions** in the Command Palette.
