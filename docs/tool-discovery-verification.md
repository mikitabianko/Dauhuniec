# Tool discovery verification — 22 October 2026

Implemented against the supplied discovery, recovery and diagnostic-report
specification. Existing unrelated workspace edits were preserved.

## Checks performed

- `go test ./...` and `go vet ./...`: passed on this macOS host.
- Pinned pnpm 10.28.2 extension tests: 43 tests, 42 passed and one Windows-only
  executable-launch test skipped on macOS. TypeScript compilation passed.
- The VSIX passed ZIP integrity and the existing repository verifier, including
  exact byte comparisons for all six bundled binaries, command contributions,
  documentation, resources and exclusion of test files. VS Code CLI successfully
  installed it into a disposable profile with extension-pack downloads disabled.
  Its installed CLI ran project-independent discovery and returned an existing
  absolute ST-LINK server path.
- The changed CI workflow passed `actionlint` and the patch passed
  `git diff --check`.
- Six native CLI targets built: macOS, Linux and Windows, each amd64 and arm64.
- Discovery fixtures cover explicit/previous/environment/PATH sources, versioned
  and unversioned applications, product-version metadata, numeric ordering,
  deterministic ties, incomplete candidates, per-action requirements, literal
  spaces/Unicode/brackets, symlinks, cycles, broken links and permissions.
- `de_DE.UTF-8`, `en_US.UTF-8` and `ru_RU.UTF-8` fixtures produced equivalent
  discovery results. Test executables emitted different German, English and
  Russian version messages; doctor accepted successful launches independently
  of their language.
- Real discovery found CubeIDE 2.1.1 in `/Applications/STM32CubeIDE.app`, its
  executable ST-LINK server, GNU Make and CubeMX. Project-independent discovery
  and invalid-explicit-path JSON were checked without project configuration.
- Isolated Extension Host recovery checks passed for alternative acceptance,
  rejection and cancellation, continuation of CubeMX opening, remembering failed
  selections, CLI exceptions, preserving working settings, and exporting a ZIP
  without a project while the CLI was unavailable. Native file-dialog responses
  were intercepted by the automation.
- A normal disposable VS Code profile saved a failed manual selection and then
  restored it after closing and reopening the same workspace. The active tool
  setting remained unchanged. This check used actual disk storage.
- Managed-path recovery passed without a confirmation: a moved synthetic
  installation was recovered, the working Make executable was preserved, and a
  VS Code task built successfully with optional debug components absent.
- Two sibling projects selected different CubeIDE installations and built with
  their own toolsets without overwriting the containing workspace's selection.
- The real Cortex-Debug 1.12.1 adapter received an existing absolute `serverpath`
  after substitution for both Debug and Attach, with an empty server setting,
  the legacy `serverPath` spelling, a stale managed GDB path and a pinned
  synthetic probe serial. All required debug executables were validated before
  committing managed configuration updates. Synthetic
  executables prevented any physical-board access. A deliberately failing
  server exercised started-process failure reporting.
- An independently opened diagnostic ZIP passed integrity checks. It contained
  effective debug configurations and actual ST-LINK launch commands for both
  requests. The probe serial was absent across all entries. ZIP/redaction tests
  also cover missing CLI/project data, large logs, eviction, truncation, preserved
  Unicode/space/bracket path suffixes and exclusion of unrelated data.
- macOS was enabled in both existing Go and extension CI matrices.

## Original failure and manual testing

The required empty-server case is covered by a temporary filesystem fixture
mirroring `Applications/STMicroelectronics/STM32CubeIDE*.app`, and by the real
Cortex-Debug adapter with a temporary STMicroelectronics application layout.
It succeeds without editing the server setting manually.

A manual reproduction on a German-language macOS interface, with a real
CubeIDE installation under `/Applications/STMicroelectronics`, was **not
completed**. This machine's real CubeIDE is directly under `/Applications`.
No installation directories or global OS settings were changed. Locale
variables and different directory names do not establish the original cause.
No claim is made that system language caused the reported failure.

Native Windows/Linux execution and their native dialogs were not run locally;
their discovery layouts are covered by fixtures and their CI matrix entries
are enabled. CI runs themselves have not been triggered from this workspace.
No physical flashing or debugging, automatic installation, upload, release
publication or full-disk scanning was performed.

The diagnostic recorder contains this extension session's available output.
External terminals and private VS Code output channels cannot be exported;
the report records those limits and any truncation or missing category.
