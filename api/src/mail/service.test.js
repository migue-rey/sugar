import test from 'node:test'
import assert from 'node:assert/strict'
import { createMailService } from './service.js'
import { registrationSchemaReady } from '../registration/repository.js'

test('SMTP settings validate before SQL and encryption requires an independent key', async () => {
  const saved = [], q = async (sql, args) => { saved.push([sql, args]); return { rows: [] } }
  const mail = createMailService({ q, env: {} }), valid = { host: 'smtp.example.invalid', port: 587, username: 'synthetic-user', from: 'sugar@example.invalid', password: 'invented-password' }
  for (const input of [null, [], { ...valid, port: 25 }, { ...valid, host: 'smtp.example.invalid\ninvalid' }, { ...valid, from: 'bad' }, { ...valid, clearPassword: true }, { ...valid, unknown: true }]) await assert.rejects(mail.save(input), { status: 400 })
  assert.equal(saved.length, 0)
  await assert.rejects(mail.save(valid), { code: 'SECRET_CONFIG' })
  assert.equal(saved.length, 1); assert.equal(saved[0][0].startsWith('SELECT'), true)
})

test('SMTP env fallback masks credentials and failed connection tests return a fixed message', async () => {
  const env = { SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: 'invented-password', SMTP_FROM: 'sugar@example.invalid' }
  let attempts = 0
  const mail = createMailService({ q: async () => ({ rows: [] }), env, transportFactory: () => ({ verify: async () => { attempts++; throw Error('private-diagnostic-and-password') }, close: () => {} }) })
  const response = await mail.read()
  assert.equal(response.password_configured, true); assert.equal(response.source, 'environment')
  assert.equal(JSON.stringify(response).includes(env.SMTP_PASSWORD), false)
  await assert.rejects(mail.test(), e => e.status === 502 && !e.message.includes('private-diagnostic'))
  assert.equal(attempts, 1)
})

test('registration capability marker is independent of the compatible base schema and query is bounded', async () => {
  for (const value of [undefined, 0, 1, 2]) {
    assert.equal(await registrationSchemaReady(async options => {
      assert.equal(options.query_timeout, 1000); assert.match(options.text, /registration_schema_version/)
      return { rows: value === undefined ? [] : [{ value }] }
    }), value === 1)
  }
})
