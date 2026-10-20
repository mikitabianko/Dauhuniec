import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which("sha256sum"), "sha256sum is required")
class PublishReleaseTests(unittest.TestCase):
    def publish(self, existing, tag_commit, *, corrupt_remote=False, download_status=0):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / "scripts" / "ci"
            scripts.mkdir(parents=True)
            script = scripts / "publish-release.sh"
            shutil.copyfile(Path(__file__).with_name(script.name), script)
            releases = root / "releases"
            releases.mkdir()
            payload = b"verified installer"
            (releases / "extension.vsix").write_bytes(payload)
            (releases / "SHA256SUMS").write_text(
                f"{hashlib.sha256(payload).hexdigest()}  extension.vsix\n"
            )
            published = root / "published"
            published.mkdir()
            original = b"original published installer"
            (published / "extension.vsix").write_bytes(original)
            (published / "SHA256SUMS").write_text(
                f"{hashlib.sha256(b'corrupt' if corrupt_remote else original).hexdigest()}  extension.vsix\n"
            )
            mock_bin = root / "mock-bin"
            mock_bin.mkdir()
            gh = mock_bin / "gh"
            gh.write_text('''#!/usr/bin/env bash
set -eu
case "$1 $2" in
  "release view") exit "$MOCK_RELEASE_STATUS" ;;
  "api "*) echo "$MOCK_TAG_COMMIT" ;;
  "release download")
    if [[ "$MOCK_DOWNLOAD_STATUS" != 0 ]]; then exit "$MOCK_DOWNLOAD_STATUS"; fi
    while [[ "$1" != --dir ]]; do shift; done
    cp "$MOCK_PUBLISHED_DIR/extension.vsix" "$MOCK_PUBLISHED_DIR/SHA256SUMS" "$2/"
    ;;
  "release upload"|"release create") echo "$1 $2" >> "$MOCK_WRITES" ;;
  *) exit 99 ;;
esac
''')
            gh.chmod(0o755)
            writes = root / "writes"
            result = subprocess.run(
                ["bash", str(script)], capture_output=True, text=True,
                env={
                    **os.environ, "PATH": f"{mock_bin}{os.pathsep}{os.environ['PATH']}",
                    "GH_TOKEN": "test-token", "GH_REPO": "owner/repo",
                    "RELEASE_TAG": "v0.1.2", "RELEASE_COMMIT": "a" * 40,
                    "MOCK_TAG_COMMIT": tag_commit,
                    "MOCK_RELEASE_STATUS": "0" if existing else "1",
                    "MOCK_WRITES": str(writes),
                    "MOCK_PUBLISHED_DIR": str(published),
                    "MOCK_DOWNLOAD_STATUS": str(download_status),
                },
            )
            return (
                result, writes.read_text() if writes.exists() else "",
                (releases / "extension.vsix").read_bytes(),
                (releases / "SHA256SUMS").read_text(),
            )

    def test_create_release(self):
        result, writes, payload, checksum = self.publish(False, "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(writes, "release create\n")
        self.assertEqual(payload, b"verified installer")
        self.assertIn(hashlib.sha256(payload).hexdigest(), checksum)

    def test_retry_same_commit(self):
        result, writes, payload, checksum = self.publish(True, "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(writes, "")
        self.assertEqual(payload, b"original published installer")
        self.assertIn(hashlib.sha256(payload).hexdigest(), checksum)

    def test_refuse_different_commit(self):
        result, writes, _, _ = self.publish(True, "b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing to reuse", result.stderr)
        self.assertEqual(writes, "")

    def test_corrupt_published_installer_is_rejected_without_replacing_local_files(self):
        result, writes, payload, _ = self.publish(True, "a" * 40, corrupt_remote=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(writes, "")
        self.assertEqual(payload, b"verified installer")

    def test_download_failure_does_not_publish_a_replacement(self):
        result, writes, payload, _ = self.publish(True, "a" * 40, download_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(writes, "")
        self.assertEqual(payload, b"verified installer")
