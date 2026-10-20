#!/usr/bin/env bash
# Publish the verified installer, replacing assets when the release already exists.
set -euo pipefail

: "${GH_TOKEN:?Set GH_TOKEN to a token with contents:write permission}"
: "${GH_REPO:?Set GH_REPO to the owner/repository}"
: "${RELEASE_TAG:?Set RELEASE_TAG to the version tag}"
: "${RELEASE_COMMIT:?Set RELEASE_COMMIT to the merge commit}"

cd "$(dirname "${BASH_SOURCE[0]}")/../../releases"
sha256sum --check SHA256SUMS

if gh release view "$RELEASE_TAG" > /dev/null 2>&1; then
  tag_commit=$(gh api "repos/$GH_REPO/commits/$RELEASE_TAG" --jq .sha)
  if [[ "$tag_commit" != "$RELEASE_COMMIT" ]]; then
    echo "Refusing to replace $RELEASE_TAG assets from a different commit." >&2
    exit 1
  fi
  gh release upload "$RELEASE_TAG" ./*.vsix SHA256SUMS --clobber
else
  gh release create "$RELEASE_TAG" ./*.vsix SHA256SUMS \
    --target "$RELEASE_COMMIT" --title "Dauhuniec $RELEASE_TAG" --generate-notes
fi
