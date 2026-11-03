import { createAppAuth } from '@octokit/auth-app'
import { q } from './db.js'

let running = false
export async function enqueue(kind, id, revision, yaml, query = q, target = null) {
  if (kind !== 'project' || !target?.repository) return
  await query('INSERT INTO sync_jobs(kind,record_id,revision,yaml,target_repository,target_branch) VALUES($1,$2,$3,$4,$5,$6)', [kind, id, revision, yaml, target?.repository || null, target?.branch || null])
}
export async function syncOne({ query = q, authenticate = createAppAuth, request = fetch } = {}) {
  if (running) return
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_INSTALLATION_ID || !process.env.GITHUB_PRIVATE_KEY) return
  running = true
  let job
  try {
    const jobs = await query("SELECT * FROM sync_jobs WHERE kind='project' AND status='pending' AND next_attempt_at<=now() AND target_repository IS NOT NULL ORDER BY id LIMIT 1")
    job = jobs.rows[0]
    if (!job) return
    const [owner, repo] = job.target_repository.split('/')
    const auth = authenticate({ appId: process.env.GITHUB_APP_ID, privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'), installationId: process.env.GITHUB_INSTALLATION_ID })
    const token = (await auth({ type: 'installation' })).token
    const path = `projects/${job.record_id}/revision-${job.revision}.yaml`
    const branch = job.target_branch || 'main'
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }
    const existing = await request(`${url}?ref=${encodeURIComponent(branch)}`, { headers })
    let sha
    if (existing.ok) sha = (await existing.json()).sha
    else if (existing.status !== 404) throw new Error(`GitHub read: ${existing.status}`)
    const res = await request(url, { method: 'PUT', headers, body: JSON.stringify({ message: `${job.kind} ${job.record_id} revision ${job.revision}`, content: Buffer.from(job.yaml).toString('base64'), branch, ...(sha ? { sha } : {}) }) })
    if (!res.ok) throw new Error(`GitHub write: ${res.status} ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    await query("UPDATE sync_jobs SET status='synced', error=NULL, commit_sha=$2 WHERE id=$1", [job.id, data.commit?.sha || null])
  } catch (e) {
    if (job) await query("UPDATE sync_jobs SET attempts=attempts+1,error=$2,next_attempt_at=now() + ((LEAST(POWER(2, attempts), 3600))::text || ' seconds')::interval WHERE id=$1", [job.id, String(e.message || e)])
    console.error('GitHub sync:', e.message || e)
  } finally { running = false }
}
export function startSync() { setInterval(() => syncOne().catch(console.error), 10000).unref() }

// Project-specific queue operations; starting the worker remains a bootstrap decision.
export function createProjectSyncService({ query, projects, synchronize = syncOne }) {
  return {
    async list(id, user) {
      await projects.get(id, user)
      return (await query("SELECT revision,status,attempts,error,commit_sha,created_at,target_repository,target_branch FROM sync_jobs WHERE kind='project' AND record_id=$1 ORDER BY id DESC LIMIT 10", [id])).rows
    },
    async retry(id, user) {
      await projects.get(id, user, { ownerOnly: true })
      await query("UPDATE sync_jobs SET next_attempt_at=now() WHERE kind='project' AND record_id=$1 AND status='pending'", [id])
      synchronize().catch(console.error)
    },
  }
}
