# Contributing

## Development

Run commands from the repository root unless noted otherwise. Keep code, comments
and documentation in English. The user guide is in `docs/guide.md`.

The CLI lives in `cmd/lon/`; Go tests sit beside the implementation. VS Code
extension code and tests live in `extension/src/` and `extension/src/test/`.
Templates and user documentation are embedded through `resources.go`, so a native
build always uses the resources in the current checkout.

```sh
go test ./...
go vet ./...
go run ./cmd/lon --version
go run ./cmd/package
cd extension
pnpm install --frozen-lockfile
pnpm test
```

Use `gofmt` for Go changes. Commit `go.sum` and `extension/pnpm-lock.yaml` when
dependencies change. Do not commit binaries, compiled JavaScript, installed
dependencies, serial logs, local settings or release packages.

For tests that need the real VS Code API, follow the extension's
[host test instructions](extension/README.md). These tests use an isolated profile;
some require a configured firmware workspace or a desktop session. Unit tests do
not establish that flashing or debugging works on physical boards.

## Packaging

```sh
go run ./cmd/package
cd extension
pnpm install --frozen-lockfile
pnpm test
pnpm run package
```

Packaging stages native executables and dependency notices in `extension/` and
writes the VSIX to `releases/`. These paths are generated and ignored. To remove
generated output from the repository root, run:

```sh
python3 scripts/clean.py
```

Add `--dependencies` to also remove `extension/node_modules/`.

The project's own code is licensed under the [MIT License](LICENSE). Packaging
includes this license alongside the Go runtime license and dependency notices.
Register the intended publisher before publishing to
the VS Code Marketplace; the current publisher is a local packaging identifier.

Upload binaries, checksums and VSIX packages as release assets rather than adding
them to source control. Review the staged file list for local paths and credentials.

## GitHub Actions and releases

The **Build extension** workflow runs only after a pull request is merged into
`master`. Closing a pull request without merging, opening or updating a pull
request, direct pushes and version tags do not build the extension. The checkout
uses the pull request's exact merge commit, including squash and rebase merges.

The workflow runs Go tests and vet, cross-compiles all six native executables,
installs the locked pnpm dependencies, tests the extension and packages a universal
VSIX. The package filename follows `extension/package.json`. The VSIX and its
SHA-256 checksum are available in the run's **Artifacts** section for 30 days
(GitHub sign-in required).

After the checks pass, the workflow creates a GitHub Release tagged `v<version>`
at the merge commit, with generated notes, `dauhuniec-<version>.vsix` and
`SHA256SUMS`. No manual tag push is needed. Set the version in
`extension/package.json` and update `extension/CHANGELOG.md` before merging a new
release. If the version already has a release, its downloadable assets are
replaced; the existing tag stays at its original commit. Bump the version for a
new release with its own tag.

Users download the installer from
[Releases](https://github.com/mikitabianko/Dauhuniec/releases/latest) and select
**Extensions → … → Install from VSIX…** in VS Code.

No Marketplace token or additional secret is needed. Only the release job receives
`contents: write` through the built-in `GITHUB_TOKEN`; build jobs have read access.
Repository or organization policy must allow GitHub Actions to create releases.
