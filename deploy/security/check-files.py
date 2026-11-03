#!/usr/bin/env python3
"""Read-only permissions preflight. Never reads or prints secret contents."""
import argparse
import os
from pathlib import Path
import stat


def audit(root, owner_uid=0, ssh_dir=None, ssh_owner_uid=None):
    results = []

    def check(path, label, private=False, directory=False, optional=False, executable=False, uid=owner_uid):
        try:
            info = path.lstat()
        except FileNotFoundError:
            results.append((label, 'SKIP' if optional else 'FAIL'))
            return False
        except OSError:
            results.append((label, 'FAIL'))
            return False
        valid_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        forbidden = 0o077 if private else 0o022
        valid = valid_type and info.st_uid == uid and not (stat.S_IMODE(info.st_mode) & forbidden) and bool(info.st_mode & stat.S_IRUSR)
        if directory:
            valid = valid and bool(info.st_mode & stat.S_IXUSR)
        if private and not directory:
            valid = valid and stat.S_IMODE(info.st_mode) in (0o400, 0o600)
        if executable:
            valid = valid and bool(info.st_mode & stat.S_IXUSR)
        results.append((label, 'PASS' if valid else 'FAIL'))
        return valid

    root = Path(root)
    check(root, 'deployment-directory', directory=True)
    check(root / 'security', 'security-directory', directory=True)
    check(root / '.env', 'environment', private=True)
    for name in ['compose.yaml', 'deploy.sh', 'ssh-gateway.sh', 'security/check-files.py']:
        check(root / name, name, executable=name.endswith('.sh'))
    for name in ['release.env', '.deploy.lock']:
        check(root / name, name, private=True, optional=True)
    for name in ['backups', 'secrets']:
        folder = root / name
        if check(folder, name, private=True, directory=True, optional=True):
            # No recursion or symlink following. Nested layouts need an explicit review.
            for index, entry in enumerate(folder.iterdir()):
                if index >= 10000:
                    results.append((name + '-entry-limit', 'FAIL'))
                    break
                check(entry, name + '-entry', private=True)
    if ssh_dir is not None:
        uid = os.getuid() if ssh_owner_uid is None else ssh_owner_uid
        ssh = Path(ssh_dir)
        check(ssh, 'ssh-directory', private=True, directory=True, uid=uid)
        check(ssh / 'authorized_keys', 'authorized-keys', private=True, uid=uid)
        check(ssh / 'known_hosts', 'known-hosts', private=True, uid=uid, optional=True)
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--owner-uid', type=int, default=0)
    parser.add_argument('--ssh-dir')
    parser.add_argument('--ssh-owner-uid', type=int)
    args = parser.parse_args()
    findings = audit(args.root, args.owner_uid, args.ssh_dir, args.ssh_owner_uid)
    for label, result in findings:
        print(f'{result}: {label}')
    raise SystemExit(1 if any(result == 'FAIL' for _, result in findings) else 0)
