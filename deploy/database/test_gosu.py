"""Privilege transitions of the candidate helper, using disposable no-network containers."""
import os
import subprocess
import unittest

IMAGE = os.environ.get('GOSU_TEST_IMAGE')


@unittest.skipUnless(IMAGE, 'opt-in candidate image test')
class GosuTests(unittest.TestCase):
    def run_helper(self, *args, user='0:0'):
        return subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                               '--cap-drop=ALL', '--cap-add=SETUID', '--cap-add=SETGID',
                               '--security-opt=no-new-privileges', '--user', user,
                               '--entrypoint', 'gosu', IMAGE, *args],
                              capture_output=True, text=True, timeout=20)

    def test_named_numeric_users_and_groups(self):
        for args, expected in [(('postgres', 'id', '-u'), '70'),
                               (('postgres:postgres', 'id', '-g'), '70'),
                               (('nobody', 'id', '-u'), '65534'),
                               (('12345:23456', 'id', '-u'), '12345'),
                               (('12345:23456', 'id', '-g'), '23456')]:
            with self.subTest(args=args):
                result = self.run_helper(*args)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), expected)

    def test_invalid_identity_or_command_and_unprivileged_escalation_fail(self):
        for args, user in [(('unknown-fixture-user', 'true'), '0:0'),
                           (('postgres', 'unknown-fixture-command'), '0:0'),
                           (('0:0', 'id', '-u'), '65534:65534')]:
            with self.subTest(args=args, user=user):
                self.assertNotEqual(self.run_helper(*args, user=user).returncode, 0)


if __name__ == '__main__':
    unittest.main()
