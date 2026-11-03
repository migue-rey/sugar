#!/usr/bin/env python3
"""Disposable network matrix; never changes host firewall policy or real services."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import uuid
from check import validate

ROOT = Path(__file__).resolve().parents[2]
project = 'sugar-nettest-' + uuid.uuid4().hex[:10]
# Rendering must never load the real .env or inherit credentials.
env = {key: os.environ[key] for key in ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'XDG_RUNTIME_DIR'] if key in os.environ}
env.update(RUNTIME_DB_PASSWORD='b' * 64, DB_PASSWORD='isolated-network-password', ADMIN_PASSWORD='isolated-network-password', AI_ENCRYPTION_KEY='a' * 64, IMAGE_TAG='0' * 40)


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=120, **kwargs).stdout


rendered = json.loads(run(['docker', 'compose', '--env-file', '/dev/null', '-p', project, '-f', str(ROOT / 'deploy/compose.yaml'), 'config', '--format', 'json'], env=env))
assert not validate(rendered), 'Production exposure policy failed'
with tempfile.TemporaryDirectory(prefix='sugar-network-') as folder:
    networks = {name: {key: value for key, value in data.items() if key != 'name'} for name, data in rendered['networks'].items()}
    networks['outside'] = {}
    services = {name: {'image': 'sugar-network-probe', 'command': ['serve', name], 'networks': list(service['networks'])} for name, service in rendered['services'].items()}
    services['web']['ports'] = ['127.0.0.1::80']
    services['external'] = {'image': 'sugar-network-probe', 'command': ['serve', 'external'], 'networks': ['egress']}
    services['outsider'] = {'image': 'sugar-network-probe', 'command': ['wait'], 'networks': ['outside']}
    config = Path(folder) / 'compose.json'
    config.write_text(json.dumps({'services': services, 'networks': networks}))
    base = ['docker', 'compose', '-p', project, '-f', str(config)]
    try:
        run(base + ['up', '-d'], env=env)
        ids = {name: run(base + ['ps', '-q', name], env=env).strip() for name in services}
        metadata = {name: json.loads(run(['docker', 'inspect', identifier]))[0] for name, identifier in ids.items()}
        def address(name, network):
            return metadata[name]['NetworkSettings']['Networks'][project + '_' + network]['IPAddress']
        def connect(source, host, port, expected):
            result = subprocess.run(['docker', 'exec', ids[source], 'node', '/probe.mjs', 'connect', host, str(port)], capture_output=True, timeout=10)
            assert (result.returncode == 0) == expected, 'Unexpected connection matrix: ' + source
        for _ in range(30):
            try:
                published = run(base + ['port', 'web', '80'], env=env).strip()
                with urllib.request.urlopen('http://' + published + '/health', timeout=2) as response:
                    assert response.read() == b'fixture-ok'
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise AssertionError('Loopback proxy path did not become ready')
        connect('web', 'api', 3000, True)
        connect('api', 'db', 5432, True)
        connect('api', 'external', 8080, True)
        connect('web', address('db', 'database'), 5432, False)
        connect('db', address('external', 'egress'), 8080, False)
        for name, network, port in [('api', 'application', 3000), ('db', 'database', 5432), ('web', 'front', 80)]:
            connect('outsider', address(name, network), port, False)
        outside = json.loads(run(['docker', 'network', 'inspect', project + '_outside']))[0]
        gateway = outside['IPAM']['Config'][0]['Gateway']
        connect('outsider', gateway, int(published.rsplit(':', 1)[1]), False)
        print('PASS: loopback proxy, web/API/DB paths, controlled API egress and cross-network rejection')
    finally:
        run(base + ['down', '--remove-orphans'], env=env)
