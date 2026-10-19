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
Once a repository URL is known, add it to
`extension/package.json`. Register the intended publisher before publishing to
the VS Code Marketplace; the current publisher is a local packaging identifier.

Upload binaries, checksums and VSIX packages as release assets rather than adding
them to source control. Review the staged file list for local paths and credentials.
