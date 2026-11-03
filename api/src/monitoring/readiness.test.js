import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { createReadiness, databaseProbe } from './readiness.js'
import { createApp } from '../app.js'

test('readiness caches checks and observes failures and recovery after expiry', async () => {
  let now = 0, calls = 0, healthy = true
  const check = createReadiness({ probe: async () => { calls++; return healthy }, clock: () => now, cacheMs: 10 })
  assert.equal(await check(), true)
  await tick()
  healthy = false
  assert.equal(await check(), true)
  assert.equal(calls, 1)
  now = 11
  assert.equal(await check(), false)
  await tick()
  healthy = true
  assert.equal(await check(), false)
  now = 22
  assert.equal(await check(), true)
  assert.equal(calls, 3)
})

test('one stalled probe times out without accumulating work; late settlements cannot mark ready', async () => {
  for (const fail of [false, true]) {
    let settle, calls = 0, now = 0
    const blocked = new Promise((resolve, reject) => { settle = () => fail ? reject(Error('synthetic-private-diagnostic')) : resolve(true) })
    const check = createReadiness({ probe: () => ++calls === 1 ? blocked : true, timeoutMs: 10, cacheMs: 5, clock: () => now })
    assert.deepEqual(await Promise.all(Array.from({ length: 30 }, () => check())), Array(30).fill(false))
    now = 100
    assert.equal(await check(), false)
    assert.equal(calls, 1)
    settle()
    await tick()
    assert.equal(await check(), true)
    assert.equal(calls, 2)
  }
})

test('database probe checks schema using a bounded read-only query and rejects missing/wrong markers', async () => {
  for (const value of [1, 0, 2, '1', null]) {
    const probe = databaseProbe(async options => {
      assert.equal(options.query_timeout, 1000)
      assert.equal(options.text, "SELECT value FROM settings WHERE key='schema_version'")
      return { rows: value === null ? [] : [{ value }] }
    })
    assert.equal(await probe(), value === 1)
  }
})

test('HTTP separates liveness and readiness, requires no login, and never exposes database diagnostics', async t => {
  for (const mode of ['ready', 'schema', 'error']) {
    let calls = 0
    const q = async () => {
      calls++
      if (mode === 'error') throw Error('synthetic-private-database-diagnostic')
      return { rows: [{ value: mode === 'ready' ? 1 : 2 }] }
    }
    const unexpected = () => { throw Error('unexpected dependency') }
    const app = createApp({ q, transaction: unexpected, secret: 'synthetic-readiness-secret', enqueue: unexpected, syncOne: unexpected })
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const base = `http://127.0.0.1:${server.address().port}/api`
    assert.equal(calls, 0)
    let res = await fetch(base + '/health')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.equal(calls, 0)
    res = await fetch(base + '/ready')
    assert.equal(res.status, mode === 'ready' ? 200 : 503)
    assert.equal(res.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await res.json(), { ok: mode === 'ready' })
    if (mode !== 'ready') assert.equal(res.headers.get('retry-after'), '1')
    assert.equal(calls, 1)
  }
})

test('readiness remains subject to API polling limits while liveness stays independent', async t => {
  let calls = 0
  const q = async () => { calls++; return { rows: [{ value: 1 }] } }
  const app = createApp({ q, secret: 'synthetic-rate-secret', accessConfig: { ip: 1, global: 1, keys: 10 } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/api`
  assert.equal((await fetch(url + '/ready')).status, 200)
  assert.equal((await fetch(url + '/ready')).status, 429)
  assert.equal((await fetch(url + '/health')).status, 200)
  assert.equal(calls, 1)
})
