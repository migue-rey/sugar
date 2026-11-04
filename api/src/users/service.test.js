import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { createUserService } from './service.js'

test('password changes preserve intentional spaces and notify only after an atomic successful write', async () => {
  const old = '  current-password  ', fresh = '  replacement-password  ', hash = await bcrypt.hash(old, 4), calls = []
  const service = createUserService({ passwordHash: async () => hash, password: async (id, replacement, expected) => {
    assert.equal(id, 'user'); assert.equal(expected, hash)
    assert.equal(await bcrypt.compare(fresh, replacement), true); assert.equal(await bcrypt.compare(fresh.trim(), replacement), false)
    calls.push('saved'); return true
  } }, { passwordChanged: async user => { assert.equal(user.id, 'user'); calls.push('notified') } })
  await service.password({ id: 'user' }, { currentPassword: old, newPassword: fresh })
  assert.deepEqual(calls, ['saved', 'notified'])
  await assert.rejects(service.password({ id: 'user' }, { currentPassword: old.trim(), newPassword: fresh }), { status: 400 })
  assert.deepEqual(calls, ['saved', 'notified'])
})
