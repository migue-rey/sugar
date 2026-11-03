"""Exercise the deployment template using an ephemeral self-signed TLS fixture."""
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


class EdgeTests(unittest.TestCase):
    def test_hsts_uses_real_tls_not_forwarded_headers(self):
        name = 'sugar-edge-test-' + uuid.uuid4().hex[:10]
        with tempfile.TemporaryDirectory(prefix=name) as folder:
            folder = Path(folder)
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(folder / 'private.key'), '-out', str(folder / 'certificate.crt'),
                            '-subj', '/CN=synthetic.example.invalid', '-days', '1'],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            template = (ROOT / 'deploy/nginx.conf').read_text()
            template = template.replace('listen 80;', '''listen 80;
    listen 443 ssl;
    ssl_certificate /checks/certificate.crt;
    ssl_certificate_key /checks/private.key;
    location = /fixture { return 200 'synthetic'; }''')
            (folder / 'site.conf').write_text(template)
            (folder / 'nginx.conf').write_text('events {}\nhttp { include /checks/site.conf; }\n')
            try:
                subprocess.run(['docker', 'run', '-d', '--name', name, '--network', 'none',
                                '--mount', f'type=bind,src={folder},dst=/checks,readonly',
                                'nginx:1.27-alpine', 'nginx', '-g', 'daemon off;', '-c', '/checks/nginx.conf'],
                               check=True, stdout=subprocess.DEVNULL)
                for attempt in range(30):
                    ready = subprocess.run(['docker', 'exec', name, 'wget', '-q', '-O', '/dev/null',
                                            'http://127.0.0.1/fixture'], capture_output=True, timeout=10)
                    if ready.returncode == 0:
                        break
                    time.sleep(0.1)
                else:
                    self.fail('Nginx fixture did not become ready')
                subprocess.run(['docker', 'exec', name, 'nginx', '-t', '-c', '/checks/nginx.conf'],
                               check=True, capture_output=True, timeout=10)
                for scheme in ['http', 'https']:
                    result = subprocess.run(['docker', 'exec', name, 'wget', '-S', '-O', '/dev/null',
                                             '--no-check-certificate', '--header=X-Forwarded-Proto: https',
                                             f'{scheme}://127.0.0.1/fixture'], capture_output=True, check=True)
                    headers = result.stderr.decode().lower()
                    self.assertIn('200 ok', headers)
                    if scheme == 'https':
                        self.assertIn('strict-transport-security: max-age=31536000', headers)
                        self.assertNotIn('includesubdomains', headers)
                        self.assertNotIn('preload', headers)
                    else:
                        self.assertNotIn('strict-transport-security', headers)
            finally:
                subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
