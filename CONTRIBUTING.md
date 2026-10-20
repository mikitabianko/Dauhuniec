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

The separate **Release extension** workflow runs on PR closure and only proceeds
after the pull request is merged into `master`. It reuses the CI workflow to
validate the exact merge commit before building and publishing, including squash
and rebase merges. Closing a PR without merging, direct pushes and version tags
do not build a release. Release jobs do not appear in open PR validation runs.

The CI workflow contains only validation jobs:

- `cli` runs Go tests and vet.
- `tests` runs after CLI validation, builds only the runner-native CLI needed by
  the integration test, and runs the extension tests with locked pnpm dependencies.
- `checks` reports **PR checks**, succeeding only when CLI and extension checks both pass; failures or skipped dependencies make it fail.

The release workflow contains:

- `validation` calls the same CI workflow on the merge commit.
- `build` cross-compiles all six release executables and packages the universal
  VSIX only after both test jobs succeed and the PR is merged.
- `release` publishes the installer after packaging succeeds.

Triggers, job dependencies and permissions live in
`.github/workflows/build-extension.yml` (PR checks and reusable validation) and
`.github/workflows/release-extension.yml` (release validation, packaging and
publishing). Shared Node.js/pnpm setup and
dependency installation live in the local composite action
`.github/actions/setup-extension/action.yml`.

Release scripts live in `scripts/ci/`:

- `python3 scripts/ci/verify-vsix.py` checks that the single VSIX in `releases/`
  contains the original `bin/` executables and required nonempty resources. Run
  it locally after packaging; it resolves paths relative to the repository.
- `bash scripts/ci/publish-release.sh` verifies installer checksums and creates
  or updates a GitHub Release. It requires `GH_TOKEN`, `GH_REPO`, `RELEASE_TAG`
  and `RELEASE_COMMIT`, and publishes assets from `releases/`.

To block merging when checks fail, configure a branch protection rule or ruleset
for `master` in GitHub Settings and require the **PR checks** status check. Run
the workflow on a PR once so GitHub can offer that check for selection. Do not
require release workflow checks, which do not run on open PRs.

The release build archives CLI binaries and their checksums in a tar file to
preserve executable permissions. The `native-cli` artifact contains this archive
and is available for download after merging.
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
