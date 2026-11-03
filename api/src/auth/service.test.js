import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createAuthService } from './service.js'
const id = '11111111-1111-1111-1111-111111111111', secret = 'isolated-auth-unit-secret'
const user = { id, email: 'unit@local', role: 'dev', language: 'es', theme: 'light' }
function fixture() {
  const saved = new Map(), account = { ...user, password_hash: bcrypt.hashSync('unit-password', 4), active: true }
  const sessions = {
    create: async (sid, userId, hash, expiresAt) => { assert.equal(userId, id); assert.equal(hash, account.password_hash); saved.set(sid, { expiresAt }); return true },
    user: async sid => !saved.get(sid)?.revoked && saved.has(sid) && account.active ? { ...user, role: account.role } : null,
    revoke: async sid => { if (saved.has(sid)) saved.get(sid).revoked = true },
  }
  return { service: createAuthService({ users: { findActiveByEmail: async email => email === user.email ? account : null }, sessions, secret }), saved, account }
}
test('unique sessions are revoked on logout even when the client keeps a token copy', async () => {
  const f = fixture(), one = await f.service.login({ email: user.email, password: 'unit-password' }), two = await f.service.login({ email: user.email, password: 'unit-password' })
  assert.notEqual(one.token, two.token); assert.deepEqual(await f.service.authenticate(one.token), user)
  await f.service.logout(one.token); await assert.rejects(f.service.authenticate(one.token), { status: 401 })
  assert.deepEqual(await f.service.authenticate(two.token), user)
  await f.service.logout('invalid'); await f.service.logout(null)
  f.account.role = 'view'; assert.equal((await f.service.authenticate(two.token)).role, 'view')
  f.account.active = false; await assert.rejects(f.service.authenticate(two.token), { status: 401 })
})
test('expired, legacy, wrong-algorithm and malformed tokens return 401 before session lookup', async () => {
  const f = fixture(), sid = '22222222-2222-2222-2222-222222222222'
  for (const token of [jwt.sign({ id, sid }, secret, { expiresIn: -1 }), jwt.sign({ id }, secret), jwt.sign({ id, sid }, secret, { algorithm: 'HS384' }), jwt.sign({ id, sid: 'invalid' }, secret), 'invalid', undefined]) await assert.rejects(f.service.authenticate(token), { status: 401 })
  await assert.rejects(f.service.login({ email: user.email, password: 'wrong' }), { status: 401 })
  await assert.rejects(f.service.login({ email: 'unknown', password: 'unit-password' }), { status: 401 })
  assert.equal(f.saved.size, 0)
})
test('credentials changing between password verification and session creation prevent login', async () => {
  const service = createAuthService({ users: { findActiveByEmail: async () => ({ ...user, password_hash: bcrypt.hashSync('unit-password', 4) }) }, sessions: { create: async () => false }, secret })
  await assert.rejects(service.login({ email: user.email, password: 'unit-password' }), { status: 401 })
})
