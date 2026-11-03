import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectService } from './service.js'

const user = { id: 'owner', role: 'dev' }
const yaml = 'name: Updated\nnodes: []\nedges: []\n'
function fixture({ failQueue = false, conflict = false, failHistory = false } = {}) {
  let state = { project: { id: 'p', name: 'Original', yaml, revision: 1, created_by: user.id, visibility: 'private', sync_repository: 'owner/repo', sync_branch: 'main' }, revisions: [], jobs: [], images: [] }
  const steps = [], tx = () => { throw Error('Repositories should use the injected transaction') }
  const same = query => assert.equal(query, tx)
  const projects = {
    find: async () => state.project,
    revision: async () => ({ yaml }),
    save: async (id, expected, name, content, query) => {
      same(query); steps.push('update')
      if (conflict) return undefined
      Object.assign(state.project, { name, yaml: content, revision: expected + 1 })
      return { revision: state.project.revision }
    },
    addRevision: async (id, revision, content, author, summary, query) => {
      same(query); steps.push('history')
      if (failHistory) throw Error('history failed')
      state.revisions.push({ revision, content, author, summary })
    },
  }
  const service = createProjectService({ projects,
    transaction: async fn => { const before = structuredClone(state); try { return await fn(tx) } catch (e) { state = before; throw e } },
    enqueue: async (kind, id, revision, content, query, target) => {
      same(query); steps.push('queue')
      if (failQueue) throw Error('queue failed')
      state.jobs.push({ kind, id, revision, content, target })
    },
    replaceEmbeddedImages: async (content, kind, query) => { same(query); steps.push('images'); state.images.push(kind); return content },
  })
  return { service, state: () => state, steps }
}

test('project saves and restores use one transaction for update, history, image migration and queue', async () => {
  for (const operation of ['save', 'restore']) {
    const f = fixture()
    assert.deepEqual(await f.service[operation]('p', user, { yaml, expectedRevision: 1, revision: 1 }), { revision: 2 })
    assert.deepEqual(f.steps, operation === 'restore' ? ['images', 'update', 'history', 'queue'] : ['update', 'history', 'queue'])
    assert.equal(f.state().revisions.length, 1)
    assert.equal(f.state().jobs.length, 1)
    assert.deepEqual(f.state().jobs[0].target, { repository: 'owner/repo', branch: 'main' })
  }
})

test('failures and revision conflicts do not leave partial project changes', async () => {
  for (const operation of ['save', 'restore']) {
    for (const options of [{ failQueue: true }, { failHistory: true }, { conflict: true }]) {
      const f = fixture(options), before = structuredClone(f.state())
      await assert.rejects(f.service[operation]('p', user, { yaml, expectedRevision: 1, revision: 1 }), options.conflict ? { status: 409 } : /failed/)
      assert.deepEqual(f.state(), before)
      if (options.conflict) assert.equal(f.steps.includes('history'), false)
    }
  }
})

test('permission and validation failures happen before any write or queue operation', async () => {
  const f = fixture(), before = structuredClone(f.state())
  await assert.rejects(f.service.save('p', { id: 'stranger', role: 'dev' }, { yaml, expectedRevision: 1 }), { status: 403, message: 'Proyecto privado' })
  await assert.rejects(f.service.save('p', user, { yaml, expectedRevision: 0 }), { status: 400, message: 'Revisión esperada inválida' })
  assert.deepEqual(f.steps, [])
  assert.deepEqual(f.state(), before)
})
