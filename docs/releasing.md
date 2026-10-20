# Release administration

## GitHub Actions

[PR checks](../.github/workflows/build-extension.yml) validate pull requests into
`master`, testing the PR merge commit. New commits cancel outdated PR checks.
Go and extension tests run on Linux, Windows and macOS. Every PR also builds
all six CLI binaries, packages the universal VSIX and verifies its contents.
Configure branch protection for `master` to require **PR checks**; release jobs
should not be required checks because they do not run on open PRs.

[Release extension](../.github/workflows/release-extension.yml) runs on pushes to
`master`, including direct pushes. Validation runs alongside version planning
and packaging. Publication requires successful validation and packaging of the
same commit. Release runs are serialized to prevent overlapping publication.
The concurrency queue retains up to 100 pending runs instead of replacing the
previous pending run when another commit arrives.
Pushing a tag alone does not trigger a release.

The version in `extension/package.json` determines the `v<version>` tag:

- A missing tag allows a new build and release.
- A tag pointing to another commit skips packaging and publication; validation
  still runs. Bump the version to release new changes.
- A tag on the current commit permits retries. If a GitHub Release already
  exists, its original installer and checksum are downloaded and verified,
  then reused for Marketplace publication. Published assets are never replaced.
  Missing or corrupt assets fail the retry; a release on another commit is rejected.
  Marketplace publication skips versions that are already published.

Releases contain the universal VSIX with all six CLI binaries and `SHA256SUMS`.
The same installer and checksum are retained as workflow artifacts for 30 days.
The `-vsix` artifact contains the current build; the `-published` artifact contains
the installer actually published to GitHub and is the only input to Marketplace.
Only the GitHub Release job receives `contents: write`; repository or organization
policy must allow GitHub Actions to create releases.

Job dependencies and permissions are defined in the workflows linked above.
Shared setup lives in [setup-go](../.github/actions/setup-go/action.yml) and
[setup-extension](../.github/actions/setup-extension/action.yml). Go module
caches are shared; compiler caches are scoped by job and refreshed per commit.
PR and release packaging share [package-extension](../.github/actions/package-extension/action.yml).

## Release scripts

Scripts in [`scripts/ci/`](../scripts/ci/) handle version planning, VSIX
verification and publication. CI runs their regression tests; run them locally
with:

```sh
node --test scripts/ci/plan-release.test.cjs
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
```

`publish-release.sh` expects `GH_TOKEN`, `GH_REPO`, `RELEASE_TAG` and
`RELEASE_COMMIT`, and publishes the verified files from `releases/`.

## Marketplace setup

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

New versions pushed to `master` publish automatically after validation, packaging
and the GitHub Release. Increase `extension/package.json`'s version and update the
changelog before each Marketplace release: Marketplace cannot overwrite an
existing version. Publication uses `--skip-duplicate` so rerunning the original
commit succeeds when that version is already on Marketplace. To disable Marketplace
publication while retaining GitHub Releases, remove the variable or set it to `false`.

Only the Marketplace job receives `id-token: write` and uses the Entra ID secrets
during Azure login.

See the [Marketplace publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
and [Azure Login documentation](https://github.com/Azure/login#login-without-subscription).
