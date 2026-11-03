#!/usr/bin/env python3
"""Scan committed history offline; never mount .env/untracked files or publish findings."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

IMAGE = 'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f'  # v8.30.1


def scan(source):
    with tempfile.TemporaryDirectory(prefix='sugar-secret-scan-') as directory:
        root = Path(directory)
        repository = root / 'repository'
        report = root / 'reports'
        report.mkdir(mode=0o700)
        # Local Git transport, no hardlinks and no working checkout: untracked files
        # and symlinks in the user's worktree are never supplied to the scanner.
        subprocess.run(['git', 'clone', '--quiet', '--no-local', '--no-hardlinks', '--no-checkout',
                        str(source), str(repository)], check=True, capture_output=True, timeout=60)
        result = subprocess.run([
            'docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user', f'{os.getuid()}:{os.getgid()}',
            '--mount', f'type=bind,src={repository},dst=/repo,readonly',
            '--mount', f'type=bind,src={report},dst=/reports',
            '--mount', f'type=bind,src={Path(__file__).with_name("gitleaks.toml")},dst=/policy.toml,readonly',
            IMAGE, 'git', '/repo', '--log-opts=--all', '--config=/policy.toml',
            '--gitleaks-ignore-path=/dev/null', '--ignore-gitleaks-allow', '--no-banner', '--no-color',
            '--redact=100', '--report-format=json', '--report-path=/reports/findings.json', '--timeout=180',
        ], capture_output=True, timeout=210)
        if result.returncode not in (0, 1):
            raise RuntimeError('scanner did not complete')
        findings = json.loads((report / 'findings.json').read_text())
        if not isinstance(findings, list) or (result.returncode == 0) != (len(findings) == 0):
            raise RuntimeError('invalid scanner report')
        # Even redacted match contexts can contain private information. Print counts only.
        print(f'Secret scan: {len(findings)} potential findings; ' + ('BLOCKED' if findings else 'PASS'))
        return bool(findings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    try:
        return int(scan(args.source.resolve()))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('Secret scan incomplete: BLOCKED (no diagnostic contents published).')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
