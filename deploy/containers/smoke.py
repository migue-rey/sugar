#!/usr/bin/env python3
"""Exercise the real image/policy in disposable Compose, never the user's installation."""
import json
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
from check import validate

ROOT = Path(__file__).resolve().parents[2]


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=240, **kwargs).stdout


def main(preview=False):
    project = 'sugar-privilege-test-' + uuid.uuid4().hex[:10]
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'XDG_RUNTIME_DIR'] if key in os.environ}
    env.update(DB_PASSWORD='synthetic-container-password', ADMIN_EMAIL='admin@example.invalid',
               ADMIN_PASSWORD='isolated-container-password', AI_ENCRYPTION_KEY='a' * 64,
               JWT_SECRET='synthetic-container-secret-at-least-thirty-two-bytes', IMAGE_TAG='0' * 40)
    configs = []
    for file in ['compose.yaml', 'deploy/compose.yaml']:
        config = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '-p', project,
                                 '-f', str(ROOT / file), 'config', '--format', 'json'], env=env))
        assert not validate(config), 'API container policy failed: ' + file
        configs.append(config)
    config = configs[1]
    services = config['services']
    services['api']['image'] = 'sugar-privilege-api-check'
    services['web']['image'] = 'sugar-privilege-web'
    services['web'].pop('ports', None)
    if preview:
        services['web']['ports'] = ['127.0.0.1:8091:80']
        services['api']['environment'].update(PUBLIC_ORIGIN='http://localhost:8091', SESSION_SECURE='false')
    # No egress at all: providers are mocked inside the test-only image/process.
    networks = {name: {'internal': True} for name in config['networks']}
    if preview:
        networks['front'] = {}  # Docker publishes loopback only on a non-internal front network.
    config = {'services': services, 'networks': networks, 'volumes': {'postgres_data': {}}}
    with tempfile.TemporaryDirectory(prefix=project) as directory:
        file = Path(directory) / 'compose.json'
        file.write_text(json.dumps(config))
        base = ['docker', 'compose', '-p', project, '-f', str(file)]
        try:
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120'], env=env)
            identifier = run(base + ['ps', '-q', 'api'], env=env).strip()
            metadata = json.loads(run(['docker', 'inspect', identifier]))[0]
            host = metadata['HostConfig']
            assert metadata['Config']['User'] == '1000:1000'
            assert host['ReadonlyRootfs'] and host['Init'] and host['PidsLimit'] == 128
            assert host['CapDrop'] == ['ALL'] and not host['CapAdd'] and not host['Privileged']
            assert 'no-new-privileges:true' in host['SecurityOpt']
            assert not host.get('Binds') and not host.get('PortBindings')
            state = run(base + ['exec', '-T', 'api', 'node', '/checks/verify.mjs', 'create'], env=env)
            json.loads(state)  # Synthetic test cookie stays in memory, never logged.
            run(base + ['restart', 'api'], env=env)
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120'], env=env)
            print(run(base + ['exec', '-T', 'api', 'node', '/checks/verify.mjs', 'persist'], input=state, env=env))
            if preview:
                print('Synthetic preview: http://localhost:8091 — press Enter to clean up.', flush=True)
                input()
        finally:
            run(base + ['down', '-v', '--remove-orphans'], env=env)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true', help='Keep synthetic HTTP preview until Enter')
    try:
        main(parser.parse_args().preview)
    except subprocess.CalledProcessError as error:
        # Test fixtures only, but never dump rendered configuration or environment.
        print(error.stderr)
        raise SystemExit(1)
