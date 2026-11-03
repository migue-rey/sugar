#!/usr/bin/env python3
"""Promote the exact API/web images scanned in this workflow run, without rebuilding."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

COMPONENTS = {'api': 'sugar-privilege-api', 'web': 'sugar-privilege-web'}


def checked(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise RuntimeError('artifact command failed')
    return result.stdout.strip()


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_manifest(path, commit):
    manifest = json.loads(path.read_text())
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or manifest.get('version') != 1 or manifest.get('commit') != commit:
        raise ValueError('artifact commit mismatch')
    for component in COMPONENTS:
        image = manifest['images'][component + '-image']
        if image.get('ref') != COMPONENTS[component] or not re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('id', '')):
            raise ValueError('invalid scanned image identity')
    return manifest


def export(directory, source, commit):
    manifest = read_manifest(source, commit)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest['archives'] = {}
    for component, ref in COMPONENTS.items():
        image_id = manifest['images'][component + '-image']['id']
        if checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref]) != image_id:
            raise ValueError('image changed after the scan')
        archive = directory / (component + '.tar')
        checked(['docker', 'save', '-o', str(archive), image_id])
        manifest['archives'][component] = digest(archive)
    (directory / 'manifest.json').write_text(json.dumps(manifest))


def promote(directory, commit, component, push=False):
    if component not in COMPONENTS:
        raise ValueError('unexpected component')
    manifest = read_manifest(directory / 'manifest.json', commit)
    archive = directory / (component + '.tar')
    if archive.is_symlink() or digest(archive) != manifest['archives'][component]:
        raise ValueError('image archive integrity check failed')
    checked(['docker', 'load', '-i', str(archive)])
    image_id = manifest['images'][component + '-image']['id']
    if checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', image_id]) != image_id:
        raise ValueError('loaded image identity mismatch')
    target = f'ghcr.io/picli3/sugar-{component}:{commit}'
    checked(['docker', 'tag', image_id, target])
    if push:
        checked(['docker', 'push', target])
    print(f'Verified {component} image for {commit}' + ('; pushed.' if push else '; no push.'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('export', 'promote'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--component', choices=tuple(COMPONENTS))
    parser.add_argument('--push', action='store_true')
    args = parser.parse_args()
    if args.action == 'export' and (not args.source or args.component or args.push):
        parser.error('export requires --source and cannot push')
    if args.action == 'promote' and (not args.component or args.source):
        parser.error('promote requires --component')
    try:
        if args.action == 'export':
            export(args.directory, args.source, args.commit)
        else:
            promote(args.directory, args.commit, args.component, args.push)
        return 0
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError):
        print('Runtime artifact verification failed; no raw diagnostics published.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
