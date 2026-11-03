import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('check_files', Path(__file__).with_name('check-files.py'))
check_files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_files)


class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        (self.root / 'security').mkdir(mode=0o700)
        for name in ['.env', 'compose.yaml', 'deploy.sh', 'ssh-gateway.sh', 'security/check-files.py']:
            target = self.root / name
            target.write_text('synthetic-secret-not-read')
            target.chmod(0o700 if name.endswith('.sh') else 0o600)

    def findings(self):
        return check_files.audit(self.root, os.getuid())

    def test_good_fixture_and_read_only_audit(self):
        before = (self.root / '.env').stat()
        self.assertNotIn('FAIL', [value for _, value in self.findings()])
        self.assertEqual((self.root / '.env').stat().st_mode, before.st_mode)
        self.assertNotIn('synthetic-secret', repr(self.findings()))

    def test_world_readable_secret_and_writable_runner_fail(self):
        (self.root / '.env').chmod(0o644)
        (self.root / 'deploy.sh').chmod(0o777)
        self.assertIn(('environment', 'FAIL'), self.findings())
        self.assertIn(('deploy.sh', 'FAIL'), self.findings())

    def test_symlink_and_wrong_owner_fail(self):
        (self.root / '.env').unlink()
        (self.root / '.env').symlink_to(self.root / 'compose.yaml')
        self.assertIn(('environment', 'FAIL'), self.findings())
        self.assertIn(('deployment-directory', 'FAIL'), check_files.audit(self.root, os.getuid() + 1))

    def test_writable_checker_parent_fails(self):
        (self.root / 'security').chmod(0o777)
        self.assertIn(('security-directory', 'FAIL'), self.findings())

    def test_private_backups_and_ssh_files(self):
        backup = self.root / 'backups'
        backup.mkdir(mode=0o700)
        (backup / 'test.dump').write_text('private-fixture')
        (backup / 'test.dump').chmod(0o644)
        self.assertIn(('backups-entry', 'FAIL'), self.findings())
        ssh = self.root / 'ssh'
        ssh.mkdir(mode=0o700)
        (ssh / 'authorized_keys').write_text('test-public-key')
        (ssh / 'authorized_keys').chmod(0o600)
        rows = check_files.audit(self.root, os.getuid(), ssh, os.getuid())
        self.assertIn(('authorized-keys', 'PASS'), rows)
        ssh.chmod(0o755)
        self.assertIn(('ssh-directory', 'FAIL'), check_files.audit(self.root, os.getuid(), ssh, os.getuid()))
