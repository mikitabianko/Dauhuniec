import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which("sha256sum"), "sha256sum is required")
class PublishReleaseTests(unittest.TestCase):
    def publish(self, existing, tag_commit):
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
            mock_bin = root / "mock-bin"
            mock_bin.mkdir()
            gh = mock_bin / "gh"
            gh.write_text('''#!/usr/bin/env bash
set -eu
case "$1 $2" in
  "release view") exit "$MOCK_RELEASE_STATUS" ;;
  "api "*) echo "$MOCK_TAG_COMMIT" ;;
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
                },
            )
            return result, writes.read_text() if writes.exists() else ""

    def test_create_release(self):
        result, writes = self.publish(False, "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(writes, "release create\n")

    def test_retry_same_commit(self):
        result, writes = self.publish(True, "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(writes, "release upload\n")

    def test_refuse_different_commit(self):
        result, writes = self.publish(True, "b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing to replace", result.stderr)
        self.assertEqual(writes, "")
