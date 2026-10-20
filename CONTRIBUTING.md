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
[host test instructions](extension/README.md#editor-title-buttons).
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
