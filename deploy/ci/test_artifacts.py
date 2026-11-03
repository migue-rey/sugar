import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('artifact', Path(__file__).with_name('runtime-artifact.py'))
ARTIFACT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARTIFACT)
COMMIT = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64


class ArtifactTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'scanned.json'
        source.write_text(json.dumps({'version': 1, 'commit': COMMIT, 'images': {
            component + '-image': {'id': IMAGE, 'ref': ref} for component, ref in ARTIFACT.COMPONENTS.items()
        }}))
        return source

    def command(self, command):
        if command[1] == 'save': Path(command[command.index('-o') + 1]).write_bytes(b'synthetic-image-archive')
        return IMAGE if 'inspect' in command else ''

    def test_export_and_promote_exact_image_without_rebuild_or_implicit_push(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / 'bundle'
            with patch.object(ARTIFACT, 'checked', side_effect=self.command) as command, contextlib.redirect_stdout(io.StringIO()):
                ARTIFACT.export(bundle, self.fixture(root), COMMIT)
                ARTIFACT.promote(bundle, COMMIT, 'api')
                calls = [call.args[0] for call in command.call_args_list]
                self.assertTrue(any('load' in call for call in calls))
                self.assertFalse(any('build' in call or 'push' in call for call in calls))
                self.assertIn(['docker', 'tag', IMAGE, 'ghcr.io/picli3/sugar-api:' + COMMIT], calls)
                ARTIFACT.promote(bundle, COMMIT, 'web', push=True)
                self.assertEqual(command.call_args.args[0], ['docker', 'push', 'ghcr.io/picli3/sugar-web:' + COMMIT])

    def test_tampered_archive_wrong_commit_or_loaded_identity_never_push(self):
        for change in ('archive', 'commit', 'loaded'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                bundle = root / 'bundle'
                with patch.object(ARTIFACT, 'checked', side_effect=self.command):
                    ARTIFACT.export(bundle, self.fixture(root), COMMIT)
                if change == 'archive': (bundle / 'api.tar').write_bytes(b'tampered')
                with patch.object(ARTIFACT, 'checked', return_value='sha256:different') as command, self.assertRaises(ValueError):
                    ARTIFACT.promote(bundle, 'c' * 40 if change == 'commit' else COMMIT, 'api', push=True)
                self.assertFalse(any('push' in call.args[0] for call in command.call_args_list))

    def test_image_change_since_scan_and_unknown_component_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(ARTIFACT, 'checked', return_value='sha256:different'), self.assertRaises(ValueError):
                ARTIFACT.export(root / 'bundle', self.fixture(root), COMMIT)
            with self.assertRaises(ValueError): ARTIFACT.promote(root, COMMIT, 'other', push=True)

    @unittest.skipUnless(os.environ.get('ARTIFACT_DOCKER_TEST') == '1', 'opt-in disposable Docker transport test')
    def test_real_docker_transport_without_running_or_pushing_images(self):
        commit = uuid.uuid4().hex + '0' * 8
        refs = {component: f'sugar-artifact-fixture-{component}:{commit}' for component in ('api', 'web')}
        created = []
        with tempfile.TemporaryDirectory(prefix='sugar-artifact-fixture-') as directory:
            root = Path(directory)
            try:
                (root / 'Dockerfile').write_text('FROM scratch\nCOPY fixture /fixture\n')
                (root / 'fixture').write_text(commit)
                images = {}
                for component, ref in refs.items():
                    ARTIFACT.checked(['docker', 'build', '-t', ref, str(root)])
                    created.append(ref)
                    images[component + '-image'] = {'ref': ref, 'id': ARTIFACT.checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref])}
                source = root / 'fixture-manifest.json'
                source.write_text(json.dumps({'version': 1, 'commit': commit, 'images': images}))
                # This is a transport fixture, not a successful vulnerability scan.
                with patch.dict(ARTIFACT.COMPONENTS, refs, clear=True), contextlib.redirect_stdout(io.StringIO()):
                    ARTIFACT.export(root / 'bundle', source, commit)
                    for component in refs:
                        target = f'ghcr.io/picli3/sugar-{component}:{commit}'
                        created.append(target)
                        ARTIFACT.promote(root / 'bundle', commit, component)
                        self.assertEqual(ARTIFACT.checked(['docker', 'image', 'inspect', '--format', '{{.Id}}', target]), images[component + '-image']['id'])
            finally:
                for ref in reversed(created):
                    ARTIFACT.checked(['docker', 'image', 'rm', ref])


if __name__ == '__main__':
    unittest.main()
