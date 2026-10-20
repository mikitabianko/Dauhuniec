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

The separate **Release extension** workflow runs on pushes to `master`, including
PR merges and direct pushes. It reuses the CI workflow to validate the exact
pushed commit before building and publishing, including squash and rebase merges.
Every checkout is pinned to the event SHA. Closing an unmerged PR and pushing
version tags do not build a release. Release jobs do not appear in open PR checks.
The push trigger gives deployment jobs the `refs/heads/master` ref required by
the `marketplace` environment; a PR ref can be rejected by that environment.

The CI workflow contains only validation jobs:

- `cli` runs Go tests and vet.
- `tests` runs in parallel with CLI validation, builds only the runner-native CLI needed by
  the integration test, and runs the extension tests with locked pnpm dependencies.
- `checks` reports **PR checks**, succeeding only when CLI and extension checks both pass; failures or skipped dependencies make it fail.

The release workflow contains:

- `validation` calls the same CI workflow on the pushed commit.
- `build` cross-compiles all six release executables and packages the universal
  VSIX only after both test jobs succeed on the pushed commit.
- `release` publishes the installer after packaging succeeds.
- `marketplace` publishes the same verified VSIX to Visual Studio Marketplace
  after the GitHub Release succeeds, when the repository Actions variable
  `MARKETPLACE_PUBLISH_ENABLED` is exactly `true`.

Release cross-compilation runs two target builds at a time with
`go run ./cmd/package -jobs 2`; local packaging defaults to one. Both modes
use the same build flags and produce checksums in the same target order.
Release Go modules and compiler outputs have a separate cache keyed by runner,
Go version, dependency files and merge commit. Each new commit restores the
previous compatible release cache and saves updated compiler outputs, so native
test jobs cannot populate the release cache with incomplete platform coverage.

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

The release build bundles all six CLI binaries inside the VSIX; no separate
CLI artifact is uploaded. The package filename follows `extension/package.json`.
The VSIX and its
SHA-256 checksum are available in the run's **Artifacts** section for 30 days
(GitHub sign-in required).

After the checks pass, the workflow creates a GitHub Release tagged `v<version>`
at the pushed commit, with generated notes, `dauhuniec-<version>.vsix` and
`SHA256SUMS`. No manual tag push is needed. Set the version in
`extension/package.json` and update `extension/CHANGELOG.md` before merging a new
release. If the version already has a release, its downloadable assets are
replaced; the existing tag stays at its original commit. Bump the version for a
new release with its own tag.

Users download the installer from
[Releases](https://github.com/mikitabianko/Dauhuniec/releases/latest) and select
**Extensions → … → Install from VSIX…** in VS Code.

Only the release job receives `contents: write` through the built-in
`GITHUB_TOKEN`; build jobs have read access. Repository or organization policy
must allow GitHub Actions to create releases.

### Marketplace setup

Marketplace publishing uses Microsoft Entra workload identity federation (OIDC),
without a PAT or client secret. Configure it once:

1. Register an Entra application and add a GitHub federated credential for this
   repository and the `marketplace` environment. Match the subject to the
   repository's actual OIDC configuration, including owner and repository IDs
   when immutable subjects are enabled.
2. Create the GitHub environment `marketplace`, allowing deployments only from
   the `master` branch. Leave required reviewers and the wait timer disabled
   for automatic publication.
3. Add `AZURE_CLIENT_ID` (Application/client ID) and `AZURE_TENANT_ID`
   (Directory/tenant ID) as environment or repository Actions secrets.
   Azure login uses `allow-no-subscriptions: true`; no Azure subscription ID
   is needed for an existing Entra application.
4. In Marketplace publisher management, add the application's Azure DevOps
   profile ID under **Members**
   with the **Contributor** role. The profile ID differs from the Entra client
   ID and object ID. Confirm the registered publisher matches `publisher` in
   `extension/package.json`.
5. Under GitHub **Settings > Secrets and variables > Actions > Variables**, add
   the **repository** variable `MARKETPLACE_PUBLISH_ENABLED` with value `true`.
   It must be a repository or organization variable, not an environment variable,
   because the job condition is evaluated before the environment is entered.

Subsequent pushes to `master` publish automatically after validation, packaging and the
GitHub Release. Increase `extension/package.json`'s version and update the
changelog before each Marketplace release: Marketplace cannot overwrite an
existing version. A rerun after a successful Marketplace publication will also
fail on the existing version. To disable Marketplace publication while retaining
GitHub Releases, remove the variable or set it to `false`.

Only the Marketplace job receives `id-token: write`, and it only uses the Entra
ID secrets during Azure login. The one-time identity inspection workflow has
been removed after setup; profile IDs are no longer printed by CI.

See the [Marketplace publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
and [Azure Login documentation](https://github.com/Azure/login#login-without-subscription).
