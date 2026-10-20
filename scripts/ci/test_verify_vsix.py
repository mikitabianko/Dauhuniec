import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile


spec = importlib.util.spec_from_file_location("verify_vsix", Path(__file__).with_name("verify-vsix.py"))
verify_vsix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_vsix)


class VerifyVSIXTests(unittest.TestCase):
    def check_package(self, missing_source=None, missing_bundle=None, corrupt=None, empty=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "bin").mkdir()
            (root / "releases").mkdir()
            with ZipFile(root / "releases" / "extension.vsix", "w") as package:
                for name in verify_vsix.EXPECTED_BINARIES:
                    data = b"" if name == empty else b"native executable"
                    if name != missing_source:
                        (root / "bin" / name).write_bytes(data)
                    if name != missing_bundle:
                        package.writestr(f"extension/bin/{name}", b"corrupt" if name == corrupt else data)
                for name in ["dist/extension.js", "LICENSE.txt", "GO-LICENSE.txt", "THIRD-PARTY-NOTICES.txt"]:
                    package.writestr(f"extension/{name}", b"required resource")
            with contextlib.redirect_stdout(io.StringIO()):
                verify_vsix.verify(root)

    def test_complete_package(self):
        self.check_package()

    def test_missing_target_from_both_build_and_package(self):
        with self.assertRaisesRegex(ValueError, "six built CLI binaries"):
            self.check_package(missing_source="lon-linux-arm64", missing_bundle="lon-linux-arm64")

    def test_missing_bundled_target(self):
        with self.assertRaisesRegex(ValueError, "six bundled CLI binaries"):
            self.check_package(missing_bundle="lon-windows-arm64.exe")

    def test_corrupt_bundled_target(self):
        with self.assertRaisesRegex(ValueError, "differs from the build"):
            self.check_package(corrupt="lon-darwin-arm64")

    def test_empty_target(self):
        with self.assertRaisesRegex(ValueError, "Empty CLI binary"):
            self.check_package(empty="lon-linux-amd64")
