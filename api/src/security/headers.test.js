import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { apiHeaders, requestOrigin, publicOrigin } from './headers.js'
import { errorHandler } from '../shared/http.js'
import { createApp } from '../app.js'

test('canonical origin configuration rejects paths, credentials and opaque origins', () => {
  assert.equal(publicOrigin(''), '')
  assert.equal(publicOrigin('https://sugar.example.test/'), 'https://sugar.example.test')
  assert.equal(publicOrigin('http://localhost:8091'), 'http://localhost:8091')
  for (const value of ['null', '*', 'ftp://host', 'https://user:password@host', 'https://host/path', 'https://host?x=y', 'https://host#fragment']) {
    assert.throws(() => publicOrigin(value), { code: 'SECRET_CONFIG' })
  }
})

test('write guard rejects cross-origin, sibling sites and simple forms before business rules', async t => {
  let calls = 0
  const app = express()
  app.use(apiHeaders, requestOrigin('https://sugar.example.test'))
  app.all('/probe', (_req, res) => { calls++; res.json({ ok: true }) })
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/probe`
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const headers of [
      { Origin: 'https://attacker.example.test' }, { Origin: 'null' },
      { Origin: 'https://sugar.example.test.attacker.invalid' },
      { Origin: 'https://sugar.example.test', 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://attacker.invalid', 'X-Forwarded-Host': 'sugar.example.test', 'X-Forwarded-Proto': 'https' },
      { Referer: 'https://attacker.invalid/form' }, { Referer: 'malformed' },
    ]) {
      assert.equal((await fetch(url, { method, headers })).status, 403)
    }
  }
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body: 'mutation' })).status, 415)
  }
  assert.equal(calls, 0)
  for (const headers of [
    { Origin: 'https://sugar.example.test', 'Content-Type': 'application/json; charset=utf-8' },
    { 'Sec-Fetch-Site': 'same-origin' }, { 'Content-Type': 'application/json' }, {},
    { Referer: 'https://sugar.example.test/project' },
  ]) assert.equal((await fetch(url, { method: 'POST', headers })).status, 200)
  assert.equal((await fetch(url, { headers: { Origin: 'https://attacker.invalid' } })).status, 200)
  const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://attacker.invalid' } })
  assert.equal(preflight.headers.get('access-control-allow-origin'), null)
})

test('local origin fallback preserves the exact host/port and ignores forwarded host', async t => {
  const app = express()
  app.use(requestOrigin(''))
  app.post('/', (_req, res) => res.end('ok'))
  app.use(errorHandler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(origin, { method: 'POST', headers: { Origin: origin } })).status, 200)
  assert.equal((await fetch(origin, { method: 'POST', headers: { Origin: 'https://forged.invalid', 'X-Forwarded-Host': 'forged.invalid', 'X-Forwarded-Proto': 'https' } })).status, 403)
})

test('actual API protects health, authentication, malformed payloads and errors without ETags', async t => {
  const unexpected = () => { throw Error('Unexpected DB operation') }
  const app = createApp({ q: unexpected, transaction: unexpected, secret: 'fixture', enqueue: unexpected, syncOne: unexpected })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api`
  for (const [path, options, status] of [
    ['/health', {}, 200], ['/me', {}, 401], ['/images/not-an-id/content', {}, 404],
    ['/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }, 400],
    ['/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(5000) }) }, 413],
    ['/logout', { method: 'POST', headers: { Origin: 'https://attacker.invalid' } }, 403],
  ]) {
    const response = await fetch(base + path, options)
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('pragma'), 'no-cache')
    assert.match(response.headers.get('vary'), /Cookie/)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/)
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/)
    assert.equal(response.headers.get('etag'), null)
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  }
})
