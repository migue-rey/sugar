#!/usr/bin/env python3
"""Validate deliberate publication from a rendered Compose JSON (no values printed)."""
import json
import sys


def validate(config):
    services = config.get('services', {})
    expected = {'db': {'database'}, 'api': {'application', 'database', 'egress'}, 'web': {'front', 'application'}}
    errors = []
    for name, networks in expected.items():
        service = services.get(name, {})
        if set(service.get('networks', {})) != networks:
            errors.append(name + ': unexpected network membership')
        if service.get('network_mode') or service.get('privileged'):
            errors.append(name + ': unsafe host/privileged mode')
        if name != 'web' and service.get('ports'):
            errors.append(name + ': backend must not publish ports')
        if any('/var/run/docker.sock' in str(v) for v in service.get('volumes', [])):
            errors.append(name + ': Docker socket must not be mounted')
    ports = services.get('web', {}).get('ports', [])
    if len(ports) != 1 or ports[0].get('host_ip') != '127.0.0.1' or ports[0].get('target') != 80 or str(ports[0].get('published')) != '18088':
        errors.append('web: expected only loopback HTTP publication')
    for name in ['application', 'database']:
        if not config.get('networks', {}).get(name, {}).get('internal'):
            errors.append(name + ': must be internal')
    for name, network in config.get('networks', {}).items():
        if network.get('external') or network.get('driver', 'bridge') != 'bridge':
            errors.append(name + ': unexpected shared network or driver')
    return errors


if __name__ == '__main__':
    errors = validate(json.load(sys.stdin))
    for error in errors:
        print('FAIL: ' + error)
    if not errors:
        print('PASS: production exposure policy')
    raise SystemExit(bool(errors))
