#!/usr/bin/env python3
"""Audit lockfiles and final images; never expose Docker socket to the scanner."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from vulnerabilities import apply_policy, fresh_database, image_findings, npm_findings

IMAGE = 'aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c'  # v0.76.1
ROOT = Path(__file__).resolve().parents[2]


def run(command, **kwargs):
    return subprocess.run(command, capture_output=True, timeout=600, **kwargs)


def checked(command, **kwargs):
    result = run(command, **kwargs)
    if result.returncode:
        raise RuntimeError('security command failed')
    return result.stdout


def container(cache):
    return ['docker', 'run', '--rm', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user', f'{os.getuid()}:{os.getgid()}',
            '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=512m',
            '--mount', f'type=bind,src={cache},dst=/cache']


def audits():
    findings = []
    for component in ('api', 'web'):
        for kind in ('runtime', 'build'):
            command = ['npm', 'audit', '--json', '--ignore-scripts']
            if kind == 'runtime':
                command.append('--omit=dev')
            result = run(command, cwd=ROOT / component)
            if result.returncode not in (0, 1):
                raise RuntimeError('npm audit failed')
            report = json.loads(result.stdout)
            parsed = npm_findings(report, f'{component}-{kind}')
            if result.returncode and not parsed:
                raise ValueError('inconsistent npm audit exit status')
            findings.extend(parsed)
    return findings


def images(refs, provenance=None):
    findings = []
    checked(['docker', 'pull', IMAGE])
    with tempfile.TemporaryDirectory(prefix='sugar-image-scan-') as directory:
        root = Path(directory)
        cache, output = root / 'cache', root / 'output'
        cache.mkdir(mode=0o700)
        output.mkdir(mode=0o700)
        # Networked process receives only an empty cache, no image/source/socket.
        checked(container(cache) + [IMAGE, 'image', '--download-db-only', '--no-progress', '--cache-dir', '/cache'])
        fresh_database(json.loads((cache / 'db/metadata.json').read_text()), datetime.now(timezone.utc))
        for scope, ref in zip(('api-image', 'web-image', 'database-image'), refs):
            image_id = checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref], text=True).strip()
            archive = root / 'input.tar'
            checked(['docker', 'save', '-o', str(archive), ref])
            # Offline scan of a tar: cannot start containers or contact services.
            checked(container(cache) + ['--network', 'none',
                    '--mount', f'type=bind,src={archive},dst=/input.tar,readonly',
                    '--mount', f'type=bind,src={output},dst=/output', IMAGE,
                    'image', '--input', '/input.tar', '--cache-dir', '/cache', '--skip-db-update',
                    '--skip-java-db-update', '--offline-scan', '--scanners', 'vuln',
                    '--ignorefile', '/dev/null', '--no-progress', '--format', 'json', '--output', '/output/report.json'])
            findings.extend(image_findings(json.loads((output / 'report.json').read_text()), scope, image_id))
            if provenance is not None:
                provenance[scope] = {'ref': ref, 'id': image_id}
            archive.unlink()
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--npm', action='store_true')
    parser.add_argument('--images', nargs=3, metavar=('API', 'WEB', 'DATABASE'))
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--commit')
    args = parser.parse_args()
    if not args.npm and not args.images:
        parser.error('choose --npm and/or --images')
    if (args.manifest or args.commit) and not (args.manifest and args.images and args.npm and re.fullmatch(r'[a-f0-9]{40}', args.commit or '')):
        parser.error('manifest requires all scopes and a full commit SHA')
    try:
        # A failed rescan must never leave a previous successful manifest behind.
        if args.manifest:
            args.manifest.unlink(missing_ok=True)
        findings = audits() if args.npm else []
        provenance = {}
        if args.images:
            findings.extend(images(args.images, provenance))
        exceptions = json.loads(Path(__file__).with_name('vulnerability-exceptions.json').read_text())
        # Exceptions are evaluated across all scopes in a single invocation.
        blocked = apply_policy(findings, exceptions, datetime.now(timezone.utc))
        if args.manifest and not blocked:
            if set(provenance) != {'api-image', 'web-image', 'database-image'}:
                raise ValueError('missing image scan provenance')
            args.manifest.write_text(json.dumps({'version': 2, 'commit': args.commit, 'images': provenance}))
        scopes = (['api-runtime', 'api-build', 'web-runtime', 'web-build'] if args.npm else []) + (['api-image', 'web-image', 'database-image'] if args.images else [])
        for scope in scopes:
            group = [item for item in findings if item['scope'] == scope]
            print(f'{scope}: {len(group)} findings; {sum(item["blocked"] for item in group)} blocking')
        # Only selected vulnerability fields, never raw metadata, environment or diagnostics.
        print(json.dumps(findings, ensure_ascii=True))
        print('Vulnerability scan: ' + ('BLOCKED' if blocked else 'PASS'))
        return int(blocked)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError):
        print('Vulnerability scan incomplete: BLOCKED (no raw diagnostics published).')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
