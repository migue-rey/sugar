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


def main(preview=False, database_image='sugar-privilege-database', rollback_database_image=None):
    project = 'sugar-privilege-test-' + uuid.uuid4().hex[:10]
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'XDG_RUNTIME_DIR'] if key in os.environ}
    env.update(RUNTIME_DB_PASSWORD='b' * 64, DB_PASSWORD='synthetic-container-password', ADMIN_EMAIL='admin@example.invalid',
               ADMIN_PASSWORD='isolated-container-password', AI_ENCRYPTION_KEY='a' * 64,
               JWT_SECRET='synthetic-container-secret-at-least-thirty-two-bytes', IMAGE_TAG='0' * 40)
    configs = []
    for file in ['compose.yaml', 'deploy/compose.yaml']:
        config = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '-p', project,
                                 '-f', str(ROOT / file), 'config', '--format', 'json'], env=env))
        assert not validate(config), 'API container policy failed: ' + file
        if file == 'compose.yaml':
            assert config['services']['db']['image'] == 'sugar-database:local'
            assert Path(config['services']['db']['build']['context']) == ROOT / 'deploy/database'
        else:
            assert config['services']['db']['image'] == 'ghcr.io/picli3/sugar-database:' + '0' * 40
        configs.append(config)
    config = configs[1]
    rollback_config = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '-p', project, '-f', str(ROOT / 'deploy/compose.yaml'), '-f', str(ROOT / 'deploy/legacy-rollback.yaml'), 'config', '--format', 'json'], env=env))
    assert 'postgres://designer:' in rollback_config['services']['api']['environment']['DATABASE_URL']
    assert 'postgres://sugar_runtime:' in config['services']['api']['environment']['DATABASE_URL']
    assert not config['services']['api']['environment'].get('ADMIN_PASSWORD')
    maintenance = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '--profile', 'maintenance', '-p', project, '-f', str(ROOT / 'deploy/compose.yaml'), 'config', '--format', 'json'], env=env))
    pinned_env = dict(env, API_IMAGE='sha256:' + '1' * 64, WEB_IMAGE='sha256:' + '2' * 64, DATABASE_IMAGE='sha256:' + '3' * 64)
    pinned = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '--profile', 'maintenance', '-p', project, '-f', str(ROOT / 'deploy/compose.yaml'), 'config', '--format', 'json'], env=pinned_env))
    for name, variable in [('api', 'API_IMAGE'), ('migrate', 'API_IMAGE'), ('web', 'WEB_IMAGE'), ('db', 'DATABASE_IMAGE')]:
        assert pinned['services'][name]['image'] == pinned_env[variable], 'Compose ignores the verified identity: ' + name
    config['services']['migrate'] = maintenance['services']['migrate']
    config['services']['migrate']['image'] = 'sugar-privilege-api-check'
    services = config['services']
    services['db']['image'] = rollback_database_image or database_image
    def image_id(ref):
        return run(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref]).strip()
    new_database_id = image_id(database_image)
    services['db']['image'] = rollback_database_image or new_database_id
    services['api']['image'] = image_id('sugar-privilege-api-check')
    services['migrate']['image'] = services['api']['image']
    services['web']['image'] = image_id('sugar-privilege-web')
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
            run(base + ['up', '-d', '--wait', 'db'], env=env)
            legacy = run(base + ['--profile', 'maintenance', 'run', '--rm', '--no-deps', 'migrate', 'node', '/checks/legacy-check.mjs', 'seed'], env=env).split('LEGACY_DIGEST=')[-1].strip()
            if rollback_database_image:
                old_container = run(base + ['ps', '-q', 'db'], env=env).strip()
                rollback_database_image = run(['docker', 'inspect', '--format', '{{.Image}}', old_container]).strip()
                services['db']['image'] = new_database_id
                file.write_text(json.dumps(config))
                run(base + ['up', '-d', '--wait', 'db'], env=env)
            run(base + ['--profile', 'maintenance', 'run', '--rm', '--no-deps', 'migrate'], env=env)
            rollback = run(base + ['--profile', 'maintenance', 'run', '--rm', '--no-deps', 'migrate', 'node', '/checks/legacy-check.mjs', 'rollback'], env=env).split('LEGACY_DIGEST=')[-1].strip()
            assert legacy == rollback, 'Existing data changed during migration/legacy restart'
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
            if database_image:
                # Exercise the candidate's root entrypoint on an existing volume too.
                run(base + ['stop', 'api'], env=env)
                run(base + ['restart', 'db'], env=env)
            else:
                run(base + ['restart', 'api'], env=env)
            run(base + ['up', '-d', '--wait', '--wait-timeout', '120'], env=env)
            print(run(base + ['exec', '-T', 'api', 'node', '/checks/verify.mjs', 'persist'], input=state, env=env))
            if rollback_database_image:
                # Keep the same volume while reverting the actual PostgreSQL image.
                run(base + ['stop', 'api'], env=env)
                services['db']['image'] = rollback_database_image
                file.write_text(json.dumps(config))
                run(base + ['up', '-d', '--wait', '--wait-timeout', '120'], env=env)
                run(base + ['exec', '-T', 'api', 'node', '/checks/verify.mjs', 'persist'], input=state, env=env)
                run(base + ['stop', 'api'], env=env)
                services['db']['image'] = new_database_id
                file.write_text(json.dumps(config))
                run(base + ['up', '-d', '--wait', '--wait-timeout', '120'], env=env)
                run(base + ['exec', '-T', 'api', 'node', '/checks/verify.mjs', 'persist'], input=state, env=env)
                print('PASS: original DB image → rebuilt helper → original → rebuilt, same synthetic data')
            if preview:
                print('Synthetic preview: http://localhost:8091 — press Enter to clean up.', flush=True)
                input()
        finally:
            run(base + ['down', '-v', '--remove-orphans'], env=env)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true', help='Keep synthetic HTTP preview until Enter')
    parser.add_argument('--database-image', default='sugar-privilege-database', help='DB image for disposable Compose')
    parser.add_argument('--rollback-database-image', help='Seed/revert using the previous image on the same disposable volume')
    try:
        args = parser.parse_args()
        main(args.preview, args.database_image, args.rollback_database_image)
    except subprocess.CalledProcessError as error:
        # Test fixtures only, but never dump rendered configuration or environment.
        print(error.stderr)
        raise SystemExit(1)
