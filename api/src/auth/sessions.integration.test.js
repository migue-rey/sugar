import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { createTransaction } from '../db.js'
import { createUserRepository } from '../users/repository.js'
import { createSessionRepository, initSessionDb } from './sessions.js'
import { createAuthService } from './service.js'
const url = process.env.API_TEST_URL, databaseUrl = process.env.API_TEST_DATABASE_URL
const password = 'isolated-session-password'
test('server sessions enforce revocation, expiry, credential version and live account permissions', { skip: !url || !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl }), q = (sql, args) => pool.query(sql, args)
  t.after(() => pool.end())
  const suffix = crypto.randomUUID().slice(0, 8)
  async function req(path, cookie, method = 'GET', body) {
    const res = await fetch(url + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers }
  }
  const login = async (email, pass = password) => { const r = await req('/login', null, 'POST', { email, password: pass }); assert.equal(r.status, 200); return r.cookie }
  const admin = await login('admin@local', 'local-icons-verification-password')
  const a = (await req('/users', admin, 'POST', { email: `sessions-a-${suffix}@local`, password, role: 'dev' })).body
  const b = (await req('/users', admin, 'POST', { email: `sessions-b-${suffix}@local`, password, role: 'dev' })).body
  let one = await login(a.email), two = await login(a.email), other = await login(b.email)
  await t.test('logout revokes only that identity; old cookie copies and invalid logout do not revive it', async () => {
    const before = await req('/me/sessions', one)
    assert.equal(before.status, 200); assert.equal(before.body.length, 2); assert.equal(before.body.filter(s => s.current).length, 1)
    assert.equal(before.headers.get('cache-control'), 'private, no-store')
    for (const s of before.body) assert.deepEqual(Object.keys(s).sort(), ['id','created_at','expires_at','current'].sort())
    const out = await req('/logout', one, 'POST'); assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /session=;/)
    assert.equal((await req('/me', one)).status, 401); assert.equal((await req('/me', two)).status, 200)
    assert.equal((await req('/logout', 'session=invalid', 'POST')).status, 200)
    assert.equal((await req('/logout', null, 'POST')).status, 200)
    one = await login(a.email)
  })
  await t.test('listing/revoking sessions is owner scoped; closing others retains current access', async () => {
    const foreignId = (await req('/me/sessions', other)).body[0].id
    assert.equal((await req('/me/sessions/' + foreignId, one, 'DELETE')).status, 404)
    assert.equal((await req('/me', other)).status, 200)
    assert.equal((await req('/me/sessions/revoke-others', one, 'POST')).status, 200)
    assert.equal((await req('/me', two)).status, 401); assert.equal((await req('/me', one)).status, 200)
    two = await login(a.email)
    const current = (await req('/me/sessions', two)).body.find(s => s.current)
    assert.equal((await req('/me/sessions/' + current.id, one, 'DELETE')).status, 200)
    assert.equal((await req('/me', two)).status, 401); assert.equal((await req('/me', one)).status, 200)
  })
  await t.test('session identities persist across application construction and idempotent initialization', async () => {
    await initSessionDb(q)
    const secret = (await q("SELECT value FROM settings WHERE key='jwt_secret'")).rows[0].value
    const service = createAuthService({ users: createUserRepository(q, createTransaction(pool)), sessions: createSessionRepository(q, createTransaction(pool)), secret })
    assert.equal((await service.authenticate(one.slice('session='.length))).id, a.id)
    const legacy = jwt.sign({ id: a.id }, secret, { expiresIn: '7d' })
    assert.equal((await req('/me', 'session=' + legacy)).status, 401)
    const sid = jwt.decode(one.slice('session='.length)).sid
    const expired = jwt.sign({ id: a.id, sid }, secret, { expiresIn: -1 })
    const r = await req('/me', 'session=' + expired); assert.equal(r.status, 401); assert.match(r.headers.get('set-cookie'), /session=;/)
    assert.equal((await req('/me', one)).status, 200)
    await q("UPDATE user_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [sid])
    assert.equal((await req('/me', one)).status, 401)
    one = await login(a.email)
  })
  await t.test('password changes atomically invalidate every session and reject the previous password', async () => {
    two = await login(a.email)
    assert.equal((await req('/me/password', one, 'POST', { currentPassword: 'wrong', newPassword: 'new-session-password' })).status, 400)
    assert.equal((await req('/me', two)).status, 200)
    const r = await req('/me/password', one, 'POST', { currentPassword: password, newPassword: 'new-session-password' }); assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /session=;/)
    for (const cookie of [one, two]) assert.equal((await req('/me', cookie)).status, 401)
    assert.equal((await req('/login', null, 'POST', { email: a.email, password })).status, 401)
    one = await login(a.email, 'new-session-password')
    assert.equal((await q('SELECT auth_version FROM users WHERE id=$1', [a.id])).rows[0].auth_version, 1)
  })
  await t.test('current roles are checked on every request and deactivated accounts cannot resume old sessions', async () => {
    await req('/users/' + a.id, admin, 'PATCH', { role: 'view' })
    assert.equal((await req('/me', one)).body.role, 'view')
    assert.equal((await req('/projects', one, 'POST', { name: 'Forbidden' })).status, 403)
    await req('/users/' + a.id, admin, 'DELETE')
    assert.equal((await req('/me', one)).status, 401)
    // Even a later reactivation does not revive old identities.
    await q('UPDATE users SET active=true WHERE id=$1', [a.id])
    assert.equal((await req('/me', one)).status, 401)
    assert.equal((await req('/me', other)).status, 200)
  })
  await t.test('credential/version and session revocation roll back together if storage fails', async () => {
    const transaction = createTransaction(pool)
    const hash = (await q('SELECT password_hash FROM users WHERE id=$1', [b.id])).rows[0].password_hash
    const users = createUserRepository(q, fn => transaction(tx => fn(async (sql, args) => {
      if (sql.startsWith('UPDATE user_sessions')) throw Error('Injected session storage failure')
      return tx(sql, args)
    })))
    await assert.rejects(users.password(b.id, 'not-committed', hash), /Injected session storage failure/)
    assert.equal((await q('SELECT password_hash FROM users WHERE id=$1', [b.id])).rows[0].password_hash, hash)
    assert.equal((await q('SELECT auth_version FROM users WHERE id=$1', [b.id])).rows[0].auth_version, 0)
    assert.equal((await req('/me', other)).status, 200)
    assert.equal(await users.password(b.id, 'not-committed', 'outdated-hash'), false)
  })
})
