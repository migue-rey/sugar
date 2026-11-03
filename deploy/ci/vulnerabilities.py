"""Strict dependency/image report policy. No implicit vulnerability suppression."""
from datetime import datetime, timedelta
import re


SCOPES = {'api-runtime', 'api-build', 'web-runtime', 'web-build', 'api-image', 'web-image', 'database-image'}
LEVELS = {'UNKNOWN', 'LOW', 'MODERATE', 'MEDIUM', 'HIGH', 'CRITICAL'}


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def fresh_database(metadata, now):
    updated = timestamp(metadata['UpdatedAt'])
    if metadata.get('Version') != 2 or not timedelta(0) <= now - updated <= timedelta(hours=24):
        raise ValueError('invalid or stale vulnerability database')


def npm_findings(report, scope):
    if scope not in SCOPES or report.get('auditReportVersion') != 2 or report.get('error'):
        raise ValueError('invalid npm report')
    vulnerabilities = report['vulnerabilities']
    totals = report['metadata']['vulnerabilities']
    if not isinstance(vulnerabilities, dict) or totals['total'] != len(vulnerabilities):
        raise ValueError('incomplete npm report')
    findings = []
    for name, item in vulnerabilities.items():
        severity = item['severity'].upper()
        if severity not in LEVELS or not item.get('via'):
            raise ValueError('invalid npm finding')
        # npm includes metavulnerabilities whose via entries are package names.
        # Keep those as blocking package findings; do not assume transitive means safe.
        findings.append(dict(scope=scope, id=name, package=name, version=item['range'],
                             target='package-lock.json', severity=severity,
                             fix='available' if item.get('fixAvailable') else 'not reported'))
    return findings


def image_findings(report, scope, image_id):
    if scope not in SCOPES or report.get('SchemaVersion') != 2:
        raise ValueError('invalid image report')
    metadata = report['Metadata']
    os_info = metadata['OS']
    if metadata['ImageID'] != image_id or not os_info.get('Family') or os_info.get('EOSL'):
        raise ValueError('image provenance or supported OS check failed')
    results = report['Results']
    if not isinstance(results, list) or not any(item.get('Class') == 'os-pkgs' for item in results):
        raise ValueError('missing operating system scan')
    findings = []
    for result in results:
        for item in result.get('Vulnerabilities', []):
            severity = item['Severity'].upper()
            if severity not in LEVELS or result.get('Class') not in ('os-pkgs', 'lang-pkgs'):
                raise ValueError('unrecognized vulnerability')
            findings.append(dict(scope=scope, id=item['VulnerabilityID'], package=item['PkgName'],
                                 version=item['InstalledVersion'], target=item.get('PkgPath') or result['Target'],
                                 severity=severity, fix=item.get('FixedVersion') or 'not reported',
                                 kind=result['Class']))
    return findings


def apply_policy(findings, exceptions, now):
    keys = ('scope', 'id', 'package', 'version', 'target')
    used = set()
    for exception in exceptions:
        if set(exception) != set(keys) | {'reason', 'issue', 'expires'}:
            raise ValueError('invalid exception fields')
        if exception['scope'] not in SCOPES or any(not exception[key] or '*' in exception[key] for key in keys):
            raise ValueError('exception must match one exact finding')
        if len(exception['reason'].strip()) < 30 or not re.fullmatch(r'https://github.com/picli3/sugar/issues/\d+', exception['issue']):
            raise ValueError('exception requires rationale and tracking issue')
        expiry = timestamp(exception['expires'])
        if not now < expiry <= now + timedelta(days=30):
            raise ValueError('exception expired or more than 30 days away')
    for finding in findings:
        matches = [index for index, exception in enumerate(exceptions)
                   if all(finding[key] == exception[key] for key in keys)]
        if len(matches) > 1:
            raise ValueError('duplicate exception')
        used.update(matches)
        finding['exception'] = bool(matches)
        # npm's moderate includes dependencies that execute during the build.
        threshold = {'MODERATE', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN'} if finding['scope'].endswith(('runtime', 'build')) else {'HIGH', 'CRITICAL', 'UNKNOWN'}
        finding['blocked'] = finding['severity'] in threshold and not matches
    if len(used) != len(exceptions):
        raise ValueError('stale exception no longer matches')
    return any(item['blocked'] for item in findings)
