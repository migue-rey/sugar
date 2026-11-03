#!/usr/bin/env python3
"""Encrypt a trusted producer's stdout; publish only after both processes succeed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time


def create(directory, name, recipients, command, timeout=900):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.age', name):
        raise ValueError('invalid archive name')
    if not command or not 0 < timeout <= 86400:
        raise ValueError('invalid producer or timeout')
    if not recipients or any(not re.fullmatch(r'age1[0-9a-z]{58}', r) for r in recipients):
        raise ValueError('native age public recipients required')
    # Hold the directory open, rejecting links and public/group-writable storage.
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    processes = []
    temporary = None
    try:
        info = os.fstat(directory_fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('archive directory must be owned by caller with mode 0700')
        anchor = Path(f'/proc/self/fd/{directory_fd}')
        with tempfile.NamedTemporaryFile(prefix='.partial-', dir=anchor, delete=False) as archive:
            temporary = archive.name
            deadline = time.monotonic() + timeout
            producer = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                        stdin=subprocess.DEVNULL, start_new_session=True)
            processes.append(producer)
            args = ['age', '--encrypt']
            for recipient in recipients:
                args += ['--recipient', recipient]
            encryptor = subprocess.Popen(args, stdin=producer.stdout, stdout=archive,
                                         stderr=subprocess.DEVNULL, start_new_session=True)
            processes.append(encryptor)
            producer.stdout.close()
            for process in reversed(processes):
                if process.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
                    raise RuntimeError('producer or encryption failed')
            archive.flush()
            os.fsync(archive.fileno())
        digest = hashlib.sha256()
        with open(temporary, 'rb') as ciphertext:
            for chunk in iter(lambda: ciphertext.read(1024 * 1024), b''):
                digest.update(chunk)
        size = os.stat(temporary).st_size
        # link is exclusive: an existing archive (including a symlink) is never replaced.
        os.link(temporary, name, dst_dir_fd=directory_fd)
        os.fsync(directory_fd)
        return {'status': 'encrypted', 'bytes': size, 'sha256': digest.hexdigest()}
    finally:
        for process in processes:
            # Include descendants that inherited the pipe, even if the leader exited.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        if temporary is not None:
            os.unlink(temporary)
        os.close(directory_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--recipient', action='append', required=True)
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    try:
        print(json.dumps(create(args.directory, args.name, args.recipient, command, args.timeout)))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Child diagnostics/arguments may contain credentials; never serialize them.
        print('{"status":"backup_failed"}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
