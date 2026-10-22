# Tool discovery, recovery and support reports

Dauhuniec uses the Go CLI for CubeIDE, bundled compiler/debug/programming tools,
GNU Make and CubeMX discovery. It searches known ST installation layouts, user
application directories, supported installation environment variables
(`STM32CUBEIDE_PATH`, `STM32CUBEMX_PATH`) and PATH for Make/CubeMX. It does not scan
the disk or translate directory names according to the interface language.

Run discovery from any directory, without a project:

```sh
lon tools --json --diagnostics
lon tools --json --cube-ide '/Applications/STMicroelectronics/STM32CubeIDE.app'
lon tools --json --cube-mx '/Applications/STMicroelectronics/STM32CubeMX.app'
```

The version-1 JSON includes `tools`, `details` (source, original and resolved
paths, installation identity and validation), `checks`, `alternatives`, and
`actions`. `--diagnostics` adds evaluated `candidates` and `selection` reasons.
Missing tools and invalid explicit paths are reported with exit status zero;
argument errors, internal errors and inability to run the command use nonzero
status. An invalid explicit path never silently selects an alternative.

Each action selects its own suitable toolset. Build needs GCC, objcopy, size and
Make; Flash needs CubeProgrammer; Debug needs GDB, objdump, nm, ST-LINK server and
CubeProgrammer. Build-and-Flash checks both Build and Flash. CubeMX needs only
CubeMX. GNU Make can be independent because it has no compiler ABI dependency;
other automatically selected components for an action come from one CubeIDE
installation. A previous suitable installation is preferred, then the newest
numeric installation version, then a stable path tie-break. Incomplete automatic
candidates are skipped for actions they cannot support.

Generated executable settings matching `.dauhuniec/tools.json` are managed.
Dauhuniec validates replacement tools before recovering outdated managed paths,
and records the recovery in its output. A changed executable setting or a manual
installation override is treated as a user choice. Invalid choices prompt for a
specific discovered alternative, other installations, a picker or official
downloads. Cancelling keeps working settings. Choosing an alternative validates it,
saves it, and continues the requested action. Downloads never resume a flash or
debug operation automatically.

**Select CubeIDE Installation**, **Select GNU Make**, and **Select STM32CubeMX
Installation** remember the selected path before validation. History is stored
in VS Code workspaceState, separately by project and tool; CubeMX without a
project has workspace-specific history. A failed choice is remembered for the
next picker but does not replace a working setting. Deleted choices reopen at
the nearest existing parent. Literal spaces, Unicode, brackets and symbolic
links are supported. Executables use resolved paths; picker history retains the
original selection. Debug and Attach validate `serverpath` after VS Code
substitutes variables, and repair the old `serverPath` spelling in memory.

## Sending a diagnostic report

Choose **Create Error Report** on a failure notification, or run **Dauhuniec:
Export Diagnostic Report** at any time, including without a project or working
CLI. Choose a ZIP save location. The save dialog explains the included categories.
After export, choose **Show File** or **Open Summary**. Review the report before
sending it yourself; Dauhuniec does not upload it.

The archive contains `summary.txt`, versioned `diagnostics.json`, and `logs/`.
It includes available versions, host/locale information, relevant Dauhuniec
settings and their scopes, minimal project metadata, discovery candidates and
file/symlink validation, effective debug configurations, commands, exit codes,
process creation errors, captured output, and recovery choices. Every category
records whether collection was possible and why data may be unavailable.

No builds, flashing or debug launches are rerun during export. Source files,
firmware, the full environment and unrelated settings are excluded. Home paths,
usernames and captured probe identifiers are consistently redacted while path
suffixes retain spaces, Unicode and brackets. Non-identifying home-path character
flags and Unicode code points retain clues that would otherwise be hidden by
home-directory redaction. The event ring is limited to
256 KiB, with text fields limited to 16 KiB and retained discovery/debug/failure
context limited to 128 KiB each. Eviction and truncation are reported. External
terminal output and private VS Code output channels cannot be read; available
extension-task and Cortex-Debug adapter output are captured from this session.

Locale fixtures compare German, English and Russian environment settings and
localized executable output. These tests do not establish that the original
failure was caused by the German interface. A manual test on German macOS must
be reported separately.

## Development checks

From the repository root, run `go test ./...`, `go vet ./...`, and
`pnpm --dir extension test`. The Go and extension CI matrices include macOS,
Windows and Linux. Build the six binaries with `go run ./cmd/package -jobs 2`
before running the host checks or packaging the extension.

The isolated host runner accepts `--tool-recovery`, `--tool-managed`, and
`--tool-isolation` with an empty temporary workspace. These POSIX host fixtures
use synthetic tools; recovery tests intercept dialog responses. For
`--tool-debug`, set `DAUHUNIEC_CORTEX_DEBUG_EXTENSION` to a local Cortex-Debug
installation. The runner copies it and its locally installed dependencies into
the disposable profile, and uses synthetic GDB/server/programmer executables.

For a real disk-persistence check, run with `--persist-history` and set
`DAUHUNIEC_TEST_PROFILE` to a new temporary directory. Run it again with the
same profile and workspace plus `DAUHUNIEC_VERIFY_HISTORY=1`. This uses a normal
window and a temporary driver extension because VS Code Extension Test mode
uses memory-only storage. The driver quits the disposable window after its
assertions; the runner checks its result. Do not use a regular user profile.

Per-project overrides in workspaceState keep sibling projects independent when
VS Code exposes only one shared containing-folder settings file. Successful
setup still writes the project's own merged settings and `tools.json` through
the existing backup mechanism.
