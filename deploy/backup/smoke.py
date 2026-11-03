#!/usr/bin/env python3
"""Run recovery tests on a unique internal Docker network, with no published ports."""
import subprocess
import time
import uuid


def run(*args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)


def main():
    prefix = 'sugar-backup-test-' + uuid.uuid4().hex[:12]
    db = prefix + '-db'
    checker = prefix + '-checker'
    try:
        run('docker', 'network', 'create', '--internal', prefix)
        run('docker', 'run', '-d', '--name', db, '--network', prefix,
            '-e', 'POSTGRES_USER=designer', '-e', 'POSTGRES_DB=source',
            '-e', 'POSTGRES_PASSWORD=synthetic-only-password', 'postgres:17-alpine')
        for attempt in range(60):
            result = subprocess.run(['docker', 'exec', db, 'pg_isready', '-U', 'designer', '-d', 'source'],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('disposable database not ready')
        result = run('docker', 'run', '--name', checker, '--network', prefix, '--read-only',
                     '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=128m', '--cap-drop=ALL',
                     '--security-opt=no-new-privileges', '-e', f'BACKUP_TEST_DATABASE_HOST={db}',
                     'sugar-backup-test', timeout=180)
        print(result.stdout.decode())
    except subprocess.CalledProcessError as error:
        print(error.stdout.decode())
        raise SystemExit(1)
    finally:
        for container in (checker, db):
            subprocess.run(['docker', 'rm', '-fv', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['docker', 'network', 'rm', prefix], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
