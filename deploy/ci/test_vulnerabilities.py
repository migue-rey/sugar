import copy
import contextlib
import importlib.util
import io
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from unittest.mock import patch
import unittest
from vulnerabilities import apply_policy, fresh_database, image_findings, npm_findings

NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
SPEC = importlib.util.spec_from_file_location('scanner', Path(__file__).with_name('scan-vulnerabilities.py'))
SCANNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCANNER)


class VulnerabilityTests(unittest.TestCase):
    def finding(self, **changes):
        return dict(dict(scope='api-image', id='CVE-test', package='sample', version='1.0',
                         target='lib/sample', severity='HIGH', fix='not reported'), **changes)

    def exception(self):
        return {**{key: self.finding()[key] for key in ('scope', 'id', 'package', 'version', 'target')},
                'reason': 'Reviewed synthetic fixture: exact package and scope only.',
                'issue': 'https://github.com/picli3/sugar/issues/14',
                'expires': (NOW + timedelta(days=1)).isoformat()}

    def test_thresholds_include_unfixed_and_unknown(self):
        for severity in ('HIGH', 'CRITICAL', 'UNKNOWN'):
            self.assertTrue(apply_policy([self.finding(severity=severity)], [], NOW))
        self.assertFalse(apply_policy([self.finding(severity='MEDIUM')], [], NOW))
        for scope in ('api-runtime', 'api-build', 'web-runtime', 'web-build'):
            self.assertTrue(apply_policy([self.finding(scope=scope, severity='MODERATE')], [], NOW))

    def test_exceptions_cannot_expand_scope_or_outlive_review(self):
        self.assertFalse(apply_policy([self.finding()], [self.exception()], NOW))
        for key, value in [('scope', 'web-image'), ('version', '2.0'), ('target', 'other/path')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                apply_policy([self.finding(**{key: value})], [self.exception()], NOW)
        for key, value in [('expires', NOW.isoformat()),
                           ('expires', (NOW + timedelta(days=31)).isoformat()),
                           ('version', '*'), ('reason', 'skip'), ('issue', 'untracked')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                exception = self.exception()
                exception[key] = value
                apply_policy([self.finding()], [exception], NOW)

    def test_database_must_be_fresh_and_versioned(self):
        fresh_database({'Version': 2, 'UpdatedAt': NOW.isoformat()}, NOW)
        for hours in (-1, 25):
            with self.assertRaises(ValueError):
                fresh_database({'Version': 2, 'UpdatedAt': (NOW - timedelta(hours=hours)).isoformat()}, NOW)
        with self.assertRaises(ValueError):
            fresh_database({'Version': 1, 'UpdatedAt': NOW.isoformat()}, NOW)

    def test_image_provenance_coverage_and_findings(self):
        report = {'SchemaVersion': 2, 'Metadata': {'ImageID': 'sha256:test', 'OS': {'Family': 'alpine'}},
                  'Results': [{'Class': 'os-pkgs', 'Target': 'alpine', 'Vulnerabilities': [
                      {'VulnerabilityID': 'CVE-test', 'PkgName': 'sample', 'InstalledVersion': '1.0', 'Severity': 'HIGH'}]}]}
        findings = image_findings(report, 'api-image', 'sha256:test')
        self.assertTrue(apply_policy(findings, [], NOW))
        for change in ('id', 'eosl', 'coverage', 'severity'):
            broken = copy.deepcopy(report)
            if change == 'id': broken['Metadata']['ImageID'] = 'other'
            if change == 'eosl': broken['Metadata']['OS']['EOSL'] = True
            if change == 'coverage': broken['Results'] = []
            if change == 'severity': broken['Results'][0]['Vulnerabilities'][0]['Severity'] = 'surprise'
            with self.subTest(change=change), self.assertRaises(ValueError):
                image_findings(broken, 'api-image', 'sha256:test')

    def test_npm_reports_and_transitive_findings_fail_closed(self):
        report = {'auditReportVersion': 2, 'vulnerabilities': {}, 'metadata': {'vulnerabilities': {'total': 0}}}
        self.assertEqual(npm_findings(report, 'api-runtime'), [])
        report['vulnerabilities']['sample'] = {'severity': 'moderate', 'range': '<2', 'via': ['parent'], 'fixAvailable': False}
        with self.assertRaises(ValueError): npm_findings(report, 'api-runtime')
        report['metadata']['vulnerabilities']['total'] = 1
        self.assertTrue(apply_policy(npm_findings(report, 'api-runtime'), [], NOW))
        report['error'] = {'code': 'ENETUNREACH'}
        with self.assertRaises(ValueError): npm_findings(report, 'api-runtime')

    def test_scanner_errors_block_without_diagnostic_leaks(self):
        output = io.StringIO()
        with patch('sys.argv', ['scan', '--images', 'api', 'web', 'db']), \
                patch.object(SCANNER, 'images', side_effect=RuntimeError('synthetic-private-diagnostic')), \
                contextlib.redirect_stdout(output):
            self.assertEqual(SCANNER.main(), 2)
        self.assertIn('BLOCKED', output.getvalue())
        self.assertNotIn('synthetic-private-diagnostic', output.getvalue())

    def test_download_has_no_source_and_scans_are_offline(self):
        commands = []

        def checked(command, **kwargs):
            commands.append(command)
            mounts = [command[index + 1] for index, value in enumerate(command) if value == '--mount']
            for mount in mounts:
                if 'dst=/cache' in mount and '--download-db-only' in command:
                    cache = Path(mount.split('src=')[1].split(',')[0]) / 'db'
                    cache.mkdir()
                    (cache / 'metadata.json').write_text(json.dumps({'Version': 2, 'UpdatedAt': datetime.now(timezone.utc).isoformat()}))
                if 'dst=/output' in mount:
                    output = Path(mount.split('src=')[1].split(',')[0]) / 'report.json'
                    output.write_text(json.dumps({'SchemaVersion': 2, 'Metadata': {'ImageID': 'sha256:fixture', 'OS': {'Family': 'alpine'}}, 'Results': [{'Class': 'os-pkgs'}]}))
            if 'save' in command: Path(command[command.index('-o') + 1]).touch()
            return 'sha256:fixture\n' if 'inspect' in command else b''

        with patch.object(SCANNER, 'checked', side_effect=checked):
            self.assertEqual(SCANNER.images(['api', 'web', 'db']), [])
        docker_runs = [command for command in commands if command[:2] == ['docker', 'run']]
        self.assertEqual(len(docker_runs), 4)
        self.assertEqual(docker_runs[0].count('--mount'), 1)
        for command in docker_runs[1:]:
            self.assertIn('--offline-scan', command)
            self.assertIn('--skip-db-update', command)
            self.assertEqual(command[command.index('--network') + 1], 'none')
        self.assertFalse(any('docker.sock' in arg or 'dst=/repo,' in arg or 'dst=/repo/' in arg for command in docker_runs for arg in command))


if __name__ == '__main__':
    unittest.main()
