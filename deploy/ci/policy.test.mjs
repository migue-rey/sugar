import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { YAML, validate } from './policy.mjs'
const fixture = () => YAML.parse(fs.readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'))
test('workflow separates validation from main-only publication and deployment', () => assert.deepEqual(validate(fixture()), []))
test('workflow rejects unsafe release and validation changes', () => {
  const changes = [
    w => { w.jobs.publish.if = 'true' }, w => { w.jobs.deploy.if = 'true' },
    w => { w.jobs.publish.needs = ['test'] }, w => { w.jobs.deploy.environment = 'development' },
    w => { w.on.pull_request_target = {} }, w => { w.on.push.branches = ['**'] },
    w => { w.permissions.contents = 'write' }, w => { w.jobs.secrets.permissions = { packages: 'write' } },
    w => { w.jobs.test.env = { PASSWORD: '${{ secrets.VPS_SSH_KEY }}' } },
    w => { w.jobs.test.steps[0].uses = 'actions/checkout@v4' },
    w => { w.jobs.test.steps[0].with['persist-credentials'] = true },
    w => { w.jobs.extra = { steps: [] } },
    w => { w.jobs.secrets.steps = w.jobs.secrets.steps.slice(0, 1) },
    w => { w.jobs.secrets.steps[0].with['fetch-depth'] = 1 },
  ]
  for (const change of changes) { const workflow = fixture(); change(workflow); assert(validate(workflow).length) }
})
