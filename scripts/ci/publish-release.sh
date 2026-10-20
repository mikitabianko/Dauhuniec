#!/usr/bin/env bash
# Publish the verified installer, reusing original assets on a retry.
set -euo pipefail

: "${GH_TOKEN:?Set GH_TOKEN to a token with contents:write permission}"
: "${GH_REPO:?Set GH_REPO to the owner/repository}"
: "${RELEASE_TAG:?Set RELEASE_TAG to the version tag}"
: "${RELEASE_COMMIT:?Set RELEASE_COMMIT to the merge commit}"

cd "$(dirname "${BASH_SOURCE[0]}")/../../releases"
sha256sum --check SHA256SUMS
shopt -s nullglob
installers=(./*.vsix)
if [[ ${#installers[@]} != 1 ]]; then
  echo "Expected exactly one installer." >&2
  exit 1
fi
installer=${installers[0]#./}

if gh release view "$RELEASE_TAG" > /dev/null 2>&1; then
  tag_commit=$(gh api "repos/$GH_REPO/commits/$RELEASE_TAG" --jq .sha)
  if [[ "$tag_commit" != "$RELEASE_COMMIT" ]]; then
    echo "Refusing to reuse $RELEASE_TAG assets from a different commit." >&2
    exit 1
  fi
  published_dir=$(mktemp -d)
  trap 'rm -rf "$published_dir"' EXIT
  gh release download "$RELEASE_TAG" --pattern "$installer" --pattern SHA256SUMS --dir "$published_dir"
  # Require a checksum for exactly the expected installer before handing it to Marketplace.
  (
    cd "$published_dir"
    sha256sum "$installer" | cmp - SHA256SUMS
    sha256sum --check SHA256SUMS
  )
  cp "$published_dir/$installer" "$installer"
  cp "$published_dir/SHA256SUMS" SHA256SUMS
  echo "Reusing the original installer from $RELEASE_TAG."
else
  gh release create "$RELEASE_TAG" ./*.vsix SHA256SUMS \
    --target "$RELEASE_COMMIT" --title "Dauhuniec $RELEASE_TAG" --generate-notes
fi
