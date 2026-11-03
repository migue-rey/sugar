import copy
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('network_policy', Path(__file__).with_name('check.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class PolicyTests(unittest.TestCase):
    def fixture(self):
        return {'services': {name: {'networks': {key: {} for key in networks}} for name, networks in {'db': ['database'], 'api': ['application', 'database', 'egress'], 'web': ['front', 'application']}.items()}, 'networks': {'database': {'internal': True}, 'application': {'internal': True}, 'front': {}, 'egress': {}}}

    def test_expected_policy(self):
        data = self.fixture()
        data['services']['web']['ports'] = [{'host_ip': '127.0.0.1', 'published': '18088', 'target': 80}]
        self.assertEqual(policy.validate(data), [])

    def test_public_backend_ports_and_shared_networks_fail(self):
        data = self.fixture()
        data['services']['db']['ports'] = [{'target': 5432, 'published': '5432'}]
        data['services']['web']['networks']['database'] = {}
        data['networks']['application']['internal'] = False
        data['networks']['front']['external'] = True
        self.assertGreaterEqual(len(policy.validate(data)), 4)

    def test_unbound_host_ports_and_host_mode_fail(self):
        data = self.fixture()
        data['services']['web']['ports'] = [{'published': '18088', 'target': 80}]
        data['services']['api']['network_mode'] = 'host'
        self.assertIn('web: expected only loopback HTTP publication', policy.validate(data))
        self.assertIn('api: unsafe host/privileged mode', policy.validate(data))
