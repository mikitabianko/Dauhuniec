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

The **Build extension** workflow checks pull requests targeting `master` when
opened, updated, reopened or marked ready for review. These checks use GitHub's
PR merge ref to test the proposed changes together with the target branch.
New commits cancel outdated checks for the same PR; different PRs run independently.

Packaging and publishing run only after the pull request is merged into `master`,
using its exact merge commit, including squash and rebase merges. Closing a PR
without merging, direct pushes and version tags do not build a release.

The workflow separates CLI validation, extension tests, packaging and publishing:

- `cli` runs Go tests and vet, then cross-compiles all six native executables.
- `tests` downloads the CLI binaries and runs the extension tests with locked pnpm dependencies.
- `checks` reports **PR checks**, succeeding only when CLI and extension checks both pass; failures or skipped dependencies make it fail.
- `build` packages the universal VSIX only after both jobs succeed, reusing the CLI binaries.
- `release` publishes the installer after packaging succeeds.

To block merging when checks fail, configure a branch protection rule or ruleset
for `master` in GitHub Settings and require the **PR checks** status check. Run
the workflow on a PR once so GitHub can offer that check for selection. Do not
require `build` or `release`, which intentionally skip PR validation runs.

CLI binaries and their checksums pass between jobs in a tar archive to preserve
executable permissions. Each consuming job verifies the checksums before use.
The `native-cli` artifact contains this archive and is also available for download.
The package filename follows `extension/package.json`. The VSIX and its
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
