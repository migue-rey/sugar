import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionRequest } from '../src/sessionRequest.ts'
test('expired sessions notify the shell once and never retry a paid request', async t => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  t.after(() => { globalThis.window = previousWindow; globalThis.fetch = previousFetch })
  globalThis.window = new EventTarget()
  let requests = 0, notifications = 0
  window.addEventListener('sugar:session-expired', () => { notifications++ })
  const failed = new Response('{}', { status: 401 })
  globalThis.fetch = async (path, options) => { requests++; assert.equal(path, '/api/projects/p/analyses'); assert.equal(options.method, 'POST'); return failed }
  assert.equal(await sessionRequest('/api/projects/p/analyses', { method: 'POST' }), failed)
  assert.equal(requests, 1); assert.equal(notifications, 1)
  globalThis.fetch = async () => new Response('{}', { status: 403 })
  await sessionRequest('/api/admin')
  assert.equal(notifications, 1)
})
