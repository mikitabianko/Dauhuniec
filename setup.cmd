@echo off
setlocal
set "kit_arch=%PROCESSOR_ARCHITECTURE%"
if defined PROCESSOR_ARCHITEW6432 set "kit_arch=%PROCESSOR_ARCHITEW6432%"
if /I "%kit_arch%"=="AMD64" goto amd64
if /I "%kit_arch%"=="ARM64" goto arm64
echo Unsupported CPU architecture: %kit_arch%
exit /b 1
:amd64
set "kit_arch=amd64"
goto run
:arm64
set "kit_arch=arm64"
:run
"%~dp0bin\lon-windows-%kit_arch%.exe" setup %*
if errorlevel 1 (
  echo Setup failed. Read the error above and README.md.
  pause
  exit /b 1
)
exit /b 0
