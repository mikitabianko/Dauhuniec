# Contributing

## Development

Use Go 1.22+, Node.js 24 and the pnpm version pinned in
[`extension/package.json`](extension/package.json). Run commands from the
repository root unless noted otherwise. Keep code, comments and documentation
in English; format Go changes with `gofmt`.

The CLI and its tests live in `cmd/lon/`; extension code and tests live in
`extension/src/` and `extension/src/test/`. Embedded CLI resources are declared
in `resources.go`. The user guide is in [`docs/guide.md`](docs/guide.md).

```sh
go test ./...
go vet ./...
go run ./cmd/package -jobs 2
pnpm --dir extension install --frozen-lockfile
pnpm --dir extension test
```

The packaging command builds all six CLI binaries, including the native binary
needed by the extension integration test. `-jobs 2` builds two targets at a time.

Commit `go.sum` and `extension/pnpm-lock.yaml` when dependencies change. Generated
binaries, JavaScript, dependencies, release packages, logs and local settings
must stay out of source control.

Tests requiring the real VS Code API are described in the extension's
[host test instructions](docs/guide.md#extension-host-checks).
Some require a configured firmware workspace or desktop session. Unit tests do
not verify flashing or debugging on physical boards.

## Packaging

After building and testing:

```sh
pnpm --dir extension run package
python3 scripts/ci/verify-vsix.py
```

The VSIX is written to `releases/`. Verification requires exactly one VSIX and
checks all six bundled binaries against `bin/`, plus required resources and
license notices. Install it using **Extensions → … → Install from VSIX…**.

Run `python3 scripts/clean.py` to remove generated output; add `--dependencies`
to also remove `extension/node_modules/`.

## README screenshots

Images live in `extension/media/screenshots/`, so the same assets can be used by
GitHub and the packaged extension README. Capture the real VS Code interface in
an isolated profile with a separate extensions directory and a temporary copy of
a CubeMX project. Load Dauhuniec with `--extensionDevelopmentPath` or install it
in that profile. Keep the user's regular profile and original project sources untouched.

The macOS screenshots show a CubeMX-generated Blink project for NUCLEO-F411RE:
a successful native build, a full-file/USER CODE comparison, documentation, target selection with
NUCLEO-H723ZG also connected, and a physical Cortex-Debug breakpoint. Blink toggles
LD2 every 500 ms; Watch shows `blink_count`. The Serial Monitor example adds
USART2 output at 115200 baud through the F411RE ST-LINK virtual serial port.
Its messages come from the physical board; the port name is hidden. The F411RE firmware upload was verified
with CubeProgrammer. The H723ZG was used for probe discovery only.

Before saving a screenshot, hide terminal sticky scroll if it exposes the task's
absolute command path. Check the entire frame for usernames, home directories,
workspace paths, machine names, connected port names, probe serials and account
information. Use a neutral demo project. For hardware captures, use an approved
board and pin its ST-LINK serial explicitly. Hide serial values in the screenshot
window without changing the target selection, and state that they are hidden.
Inspect both the rendered image and its OCR text before adding it to a README.

## Pull requests and releases

Pull requests into `master` run Go and extension checks on Linux, Windows and
macOS, and verify a complete VSIX with all six CLI targets. Pushes to `master`
validate the pushed commit and build eligible releases in parallel; publication
waits for both to pass.

For a new release, bump `extension/package.json` and update
`extension/CHANGELOG.md` before merging. If that version is already tagged at an
earlier commit, CI runs validation but skips packaging and publication. No manual
tag push is needed. Installers are published to
[GitHub Releases](https://github.com/mikitabianko/Dauhuniec/releases); Marketplace
publication runs when enabled by the repository maintainer.

See [release administration](docs/releasing.md) for branch protection,
release retries and Marketplace configuration.
