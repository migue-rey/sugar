from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

SCRIPT = Path(__file__).with_name('scan-secrets.py')


class ScannerTests(unittest.TestCase):
    def test_clean_untracked_and_historical_secret(self):
        with tempfile.TemporaryDirectory(prefix='sugar-secret-fixture-') as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)
            git('init', '-q')
            git('config', 'user.name', 'Synthetic fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            (root / 'README.md').write_text('Synthetic fixture only\n')
            git('add', 'README.md')
            git('commit', '-qm', 'Create clean fixture')
            secret = 'ghp_' + uuid.uuid4().hex + 'abcd'
            (root / '.env').write_text('GITHUB_TOKEN=' + secret + ' # gitleaks:allow\n')
            result = subprocess.run(['python3', str(SCRIPT), '--source', str(root)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertNotIn(secret.encode(), result.stdout + result.stderr)
            git('add', '.env')
            git('commit', '-qm', 'Add synthetic detector fixture')
            git('rm', '.env')
            git('commit', '-qm', 'Remove fixture from working tree')
            result = subprocess.run(['python3', str(SCRIPT), '--source', str(root)], capture_output=True)
            self.assertEqual(result.returncode, 1, result.stdout)
            self.assertIn(b'BLOCKED', result.stdout)
            self.assertNotIn(secret.encode(), result.stdout + result.stderr)

    def test_invalid_source_fails_closed_without_raw_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['python3', str(SCRIPT), '--source', directory], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn(directory.encode(), result.stdout + result.stderr)
