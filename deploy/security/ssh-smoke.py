#!/usr/bin/env python3
"""Disposable container only: no host ports, credentials, users or Docker socket."""
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import tempfile
import time


def run(args, *, success=True, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=15, **kwargs)
    if success and result.returncode:
        raise AssertionError('Isolated command failed: ' + Path(args[0]).name)
    if not success and result.returncode == 0:
        raise AssertionError('Unexpected permitted operation: ' + Path(args[0]).name)
    return result


with tempfile.TemporaryDirectory() as folder:
    work = Path(folder)
    os.chmod(work, 0o700)
    for account in ['sugar-deploy', 'operator']:
        run(['groupadd', '-f', account])
        run(['useradd', '-m', '-g', account, '-s', '/bin/bash', account])
        run(['chpasswd'], input=account + ':isolated-unused-password\n')
        ssh_dir = Path('/home') / account / '.ssh'
        ssh_dir.mkdir(mode=0o700)
        user = pwd.getpwnam(account)
        os.chown(ssh_dir, user.pw_uid, user.pw_gid)
    for name in ['host', 'operator-a', 'operator-b', 'ci']:
        run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(work / name)])
    def public(name):
        return (work / (name + '.pub')).read_text().strip()
    def keys(account, lines):
        target = Path('/home') / account / '.ssh/authorized_keys'
        target.write_text('\n'.join(lines) + '\n')
        target.chmod(0o600)
        user = pwd.getpwnam(account)
        os.chown(target, user.pw_uid, user.pw_gid)
    keys('operator', [public('operator-a'), public('operator-b')])
    keys('sugar-deploy', ['restrict,command="/srv/sugar/ssh-gateway.sh" ' + public('ci')])
    runner = Path('/srv/sugar/deploy.sh')
    runner.write_text('#!/bin/bash\n[[ $# -eq 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || exit 2\nprintf "allowed %s uid=%s\\n" "$1" "$EUID"\n')
    runner.chmod(0o755)
    sudoers = Path('/etc/sudoers.d/sugar-deploy')
    shutil.copyfile('/test/security/sudoers-sugar-deploy.example', sudoers)
    sudoers.chmod(0o440)
    run(['visudo', '-cf', str(sudoers)])
    config = work / 'sshd_config'
    config.write_text(f'Port 2222\nListenAddress 127.0.0.1\nHostKey {work}/host\nPidFile {work}/pid\nUsePAM no\n' + Path('/test/security/sshd-sugar.conf.example').read_text())
    run(['/usr/sbin/sshd', '-t', '-f', str(config)])
    effective = run(['/usr/sbin/sshd', '-T', '-f', str(config), '-C', 'user=sugar-deploy,host=localhost,addr=127.0.0.1']).stdout
    for option in ['passwordauthentication no', 'kbdinteractiveauthentication no', 'maxauthtries 3', 'disableforwarding yes', 'permittty no']:
        assert option in effective
    (work / 'known_hosts').write_text('[127.0.0.1]:2222 ' + ' '.join(public('host').split()[:2]) + '\n')
    process = subprocess.Popen(['/usr/sbin/sshd', '-D', '-e', '-f', str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        def ssh(account, key, command, success=True, extra=None):
            return run(['ssh', '-p', '2222', '-i', str(work / key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(work / 'known_hosts'), '-o', 'ConnectTimeout=2', *(extra or []), account + '@127.0.0.1', *command], success=success)
        for _ in range(30):
            try:
                result = ssh('operator', 'operator-a', ['id', '-un'])
                break
            except AssertionError:
                time.sleep(0.1)
        else:
            raise AssertionError('Isolated SSH server did not start')
        assert result.stdout.strip() == 'operator'
        assert ssh('operator', 'operator-b', ['id', '-un']).stdout.strip() == 'operator'
        ssh('operator', 'operator-a', ['id'], success=False, extra=['-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password'])
        sha = 'a' * 40
        assert f'allowed {sha} uid=0' in ssh('sugar-deploy', 'ci', ['deploy', sha]).stdout
        for command in [['id'], ['deploy', sha, 'extra'], ['deploy', sha + ';id']]:
            ssh('sugar-deploy', 'ci', command, success=False)
        ssh('sugar-deploy', 'ci', [], success=False, extra=['-N', '-R', '127.0.0.1:0:127.0.0.1:2222', '-o', 'ExitOnForwardFailure=yes'])
        # Real runner rejects extra arguments before touching its deployment directory.
        run(['bash', '/test/real-deploy.sh', sha, 'extra'], success=False)
        # The actual runner fails before reading registry input or creating a lock.
        private = Path('/srv/sugar/.env')
        private.write_text('synthetic-secret-not-printed')
        private.chmod(0o644)
        Path('/srv/sugar/compose.yaml').write_text('services: {}')
        checker_dir = Path('/srv/sugar/security')
        checker_dir.mkdir(mode=0o755)
        shutil.copyfile('/test/security/check-files.py', checker_dir / 'check-files.py')
        result = run(['bash', '/test/real-deploy.sh', sha], success=False)
        assert 'FAIL: environment' in result.stdout
        assert 'synthetic-secret-not-printed' not in result.stdout + result.stderr
        assert not Path('/srv/sugar/.deploy.lock').exists()
        private.chmod(0o600)
        sentinel = work / 'sentinel'
        sentinel.write_text('must-not-be-truncated')
        Path('/srv/sugar/.deploy.lock').symlink_to(sentinel)
        result = run(['bash', '/test/real-deploy.sh', sha], success=False)
        assert 'FAIL: .deploy.lock' in result.stdout
        assert sentinel.read_text() == 'must-not-be-truncated'
        # A compromised CI account cannot turn its sudo rule into a root shell.
        run(['runuser', '-u', 'sugar-deploy', '--', 'sudo', '-n', '/usr/bin/id'], success=False)
        keys('operator', [public('operator-b')])
        ssh('operator', 'operator-a', ['id'], success=False)
        assert ssh('operator', 'operator-b', ['id', '-un']).stdout.strip() == 'operator'
        keys('operator', [public('operator-a'), public('operator-b')])
        assert ssh('operator', 'operator-a', ['id', '-un']).stdout.strip() == 'operator'
        print('PASS: key access, alternate access, password denial, restricted CI, sudo isolation, rotation and rollback')
    finally:
        process.terminate()
        process.wait(timeout=5)
