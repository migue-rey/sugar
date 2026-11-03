import { createRequire } from 'node:module'
const require = createRequire(new URL('../../api/package.json', import.meta.url))
export const YAML = require('yaml')
export const releaseGuard = "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"

export function validate(workflow) {
  const errors = []
  const jobs = workflow.jobs || {}
  if (JSON.stringify(Object.keys(jobs).sort()) !== JSON.stringify(['deploy', 'publish', 'secrets', 'test'])) errors.push('Unexpected job: review release capabilities')
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })) errors.push('Default token must be read-only')
  const triggers = workflow.on || {}
  if (Object.keys(triggers).some(key => !['push', 'pull_request', 'workflow_dispatch'].includes(key))) errors.push('Unexpected event')
  if (JSON.stringify(triggers.push?.branches) !== JSON.stringify(['main', 'dev/**'])) errors.push('Unexpected push branches')
  for (const name of ['publish', 'deploy']) {
    if (jobs[name]?.if !== releaseGuard) errors.push(name + ': release restricted to main')
  }
  const needs = jobs.publish?.needs || []
  if (!Array.isArray(needs) || !['test', 'secrets'].every(job => needs.includes(job))) errors.push('Publish must require tests and secret scan')
  if (jobs.deploy?.needs !== 'publish' || jobs.deploy?.environment !== 'production') errors.push('Deploy must follow publish in production environment')
  const scanSteps = jobs.secrets?.steps || []
  if (!scanSteps.some(step => step.run?.includes('python3 deploy/ci/scan-secrets.py'))) errors.push('Secret scan must execute the detector')
  if (!scanSteps.some(step => step.uses?.startsWith('actions/checkout@') && step.with?.['fetch-depth'] === 0)) errors.push('Secret scan requires complete history')
  if (!(jobs.test?.steps || []).some(step => step.run?.includes('python3 deploy/ci/scan-vulnerabilities.py --npm --images sugar-privilege-api sugar-privilege-web sugar-privilege-database'))) errors.push('Dependency and runtime image gate required')
  const testSteps = jobs.test?.steps || []
  const upload = testSteps.find(step => step.uses?.startsWith('actions/upload-artifact@'))
  if (upload?.if !== releaseGuard || upload?.with?.['retention-days'] !== 1 || upload?.with?.['if-no-files-found'] !== 'error') errors.push('Release artifacts require main and bounded retention')
  if (!testSteps.some(step => step.if === releaseGuard && step.run?.includes('python3 deploy/ci/runtime-artifact.py export'))) errors.push('Release must export verified images')
  if (!testSteps.some(step => step.run?.includes('--manifest "$RUNNER_TEMP/scanned-images.json" --commit "$GITHUB_SHA"'))) errors.push('Scan must bind images to the commit')
  const publishSteps = jobs.publish?.steps || []
  if (JSON.stringify(jobs.publish?.strategy?.matrix?.component) !== JSON.stringify(['api', 'web', 'database'])) errors.push('Publish all three scanned runtime components')
  if (!publishSteps.some(step => step.uses?.startsWith('actions/download-artifact@') && !step.with?.['run-id'] && !step.with?.['github-token'])) errors.push('Publication requires artifacts from this run')
  if (!publishSteps.some(step => step.run?.includes('python3 deploy/ci/runtime-artifact.py promote') && step.run.includes('--push'))) errors.push('Publication must verify scanned images')
  if (publishSteps.some(step => step.uses?.startsWith('docker/build-push-action@') || step.run?.includes('docker build'))) errors.push('Do not rebuild images after scanning')
  const deploySteps = jobs.deploy?.steps || []
  if (!deploySteps.some(step => step.uses?.startsWith('actions/download-artifact@') && !step.with?.['run-id'] && !step.with?.['github-token'])) errors.push('Deploy requires the descriptor from this run')
  if (!deploySteps.some(step => step.run?.includes('runtime-artifact.py describe') && step.run.includes('"$REGISTRY_TOKEN" "$descriptor" | ssh') && step.run.includes('"deploy-v2 $DEPLOY_SHA"'))) errors.push('Bind deployment to scanned image identities')
  for (const name of ['test', 'secrets']) {
    const job = jobs[name] || {}
    if (job.environment || Object.values(job.permissions || {}).some(value => value !== 'read')) errors.push(name + ': unprivileged validation required')
    if (/\$\{\{\s*secrets\./.test(JSON.stringify(job))) errors.push(name + ': must not receive deployment secrets')
  }
  for (const job of Object.values(jobs)) {
    for (const step of job.steps || []) {
      if (step.uses && !/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(step.uses)) errors.push('Action must use an immutable commit SHA')
      if (step.uses?.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) errors.push('Checkout must not persist credentials')
    }
  }
  return errors
}
