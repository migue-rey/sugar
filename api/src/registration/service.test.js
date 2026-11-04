import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { createRegistrationService, registrationEmail } from './service.js'
import { registrationConfig } from './config.js'
import { createVerificationMailer } from './mail.js'

test('registration defaults off and requires an explicit canonical secure origin', () => {
  assert.deepEqual(registrationConfig({}), { enabled: false })
  assert.deepEqual(registrationConfig({ REGISTRATION_ENABLED: 'false', PUBLIC_ORIGIN: 'bad' }), { enabled: false })
  for (const env of [{ REGISTRATION_ENABLED: 'yes' }, { REGISTRATION_ENABLED: 'true' }, { REGISTRATION_ENABLED: 'true', PUBLIC_ORIGIN: 'http://example.invalid' }, { REGISTRATION_ENABLED: 'true', PUBLIC_ORIGIN: 'https://example.invalid/path' }]) assert.throws(() => registrationConfig(env), { code: 'SECRET_CONFIG' })
  assert.deepEqual(registrationConfig({ REGISTRATION_ENABLED: 'true', PUBLIC_ORIGIN: 'https://example.invalid/' }), { enabled: true, origin: 'https://example.invalid' })
  assert.throws(() => createRegistrationService({ config: { enabled: true } }), { code: 'SECRET_CONFIG' })
})

test('input whitelists prohibit roles/activation/credentials before email verification', () => {
  assert.deepEqual(registrationEmail({ email: '  TeSt@Example.invalid ', language: 'en' }), { email: 'test@example.invalid', language: 'en' })
  for (const input of [null, [], {}, { email: 'a@local' }, { email: 'a@b.invalid\r\nBcc:bad@b.invalid' }, { email: 'a@b.invalid', role: 'Admin' }, { email: 'a@b.invalid', active: true }, { email: 'a@b.invalid', password: 'attacker-password' }, { email: 'a@b.invalid', language: 'xx' }]) assert.throws(() => registrationEmail(input), { status: 400 })
})

test('links contain high-entropy tokens, only hashes persist, mail failures discard the precise token', async () => {
  let record, delivery, discarded
  const service = createRegistrationService({ config: { enabled: true, origin: 'https://example.invalid' },
    repository: { reserve: async (...args) => { record = args; return true }, discard: async hash => { discarded = hash } },
    sendVerification: async message => { delivery = message },
  })
  await service.request({ email: 'a@b.invalid' })
  const token = new URL(delivery.url).hash.slice('#verify-email='.length)
  assert.match(token, /^[a-f0-9]{64}$/)
  assert.equal(record[1], crypto.createHash('sha256').update(token).digest('hex'))
  assert.equal(record.includes(token), false); assert.equal(new URL(delivery.url).search, '')
  assert.equal(discarded, undefined)
  const failure = createRegistrationService({ config: { enabled: true, origin: 'https://example.invalid' }, repository: { reserve: async () => true, discard: async value => { discarded = value } }, sendVerification: async () => { throw Error('private-transport-password') } })
  await failure.request({ email: 'a@b.invalid' }); assert.match(discarded, /^[a-f0-9]{64}$/)
  let sent = false
  const cooling = createRegistrationService({ config: { enabled: true }, repository: { reserve: async () => false }, sendVerification: async () => { sent = true } })
  assert.equal(await cooling.request({ email: 'a@b.invalid' }), undefined); assert.equal(sent, false)
})

test('verification sets a fresh bcrypt password only after checking the token and consumes exactly once', async () => {
  let consumed = false, hashes = 0
  const token = 'ab'.repeat(32), service = createRegistrationService({ config: { enabled: true }, sendVerification: async () => {},
    repository: { valid: async () => !consumed, consume: async (_tokenHash, id, hash) => { assert.ok(await bcrypt.compare('new-safe-password', hash)); if (consumed) return null; consumed = true; return id } },
    runCredential: async task => { hashes++; return task() },
  })
  for (const input of [{ token, password: 'short' }, { token, password: 'á'.repeat(37) }, { token: 'bad', password: 'new-safe-password' }, { token, password: 'new-safe-password', role: 'Admin' }]) await assert.rejects(service.verify(input), { status: 400 })
  assert.equal(hashes, 0)
  assert.match(await service.verify({ token, password: 'new-safe-password' }), /^[0-9a-f-]{36}$/)
  await assert.rejects(service.verify({ token, password: 'new-safe-password' }), { status: 400 }); assert.equal(hashes, 1)
  const disabled = createRegistrationService({ config: { enabled: false } })
  await assert.rejects(disabled.request({ email: 'a@b.invalid' }), { status: 403 })
  await assert.rejects(disabled.verify({ token, password: 'new-safe-password' }), { status: 403 })
})

test('mail delivery concurrency is bounded until actual work finishes', async () => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const service = createRegistrationService({ config: { enabled: true, origin: 'https://example.invalid' }, repository: { reserve: async () => true }, sendVerification: () => wait })
  const one = service.request({ email: 'one@b.invalid' }), two = service.request({ email: 'two@b.invalid' })
  await assert.rejects(service.request({ email: 'three@b.invalid' }), { status: 429 })
  release(); await Promise.all([one, two]); await service.request({ email: 'four@b.invalid' })
})

test('SMTP requires authenticated verified TLS, bounded timeouts and fixed plain-text messages without logging', async () => {
  const env = { SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: 'synthetic-mail-password', SMTP_FROM: 'sugar@example.invalid' }
  let options, message, closed = 0
  const send = createVerificationMailer(env, value => { options = value; return { sendMail: async value => { message = value }, close: () => { closed++ } } })
  await send({ email: 'test@example.invalid', language: 'en', url: 'https://example.invalid/#verify-email=synthetic' })
  assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true)
  assert.equal(options.logger, false); assert.equal(options.debug, false)
  assert.equal(options.connectionTimeout, 5000); assert.equal(options.socketTimeout, 10000)
  assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true)
  assert.equal(message.html, undefined); assert.match(message.text, /30 minutes/); assert.equal(closed, 1)
  for (const override of [{ SMTP_HOST: '' }, { SMTP_PASSWORD: '' }, { SMTP_PORT: '25' }, { SMTP_FROM: 'x@example.invalid\r\nBcc:x@y.invalid' }]) assert.throws(() => createVerificationMailer({ ...env, ...override }), { code: 'SECRET_CONFIG' })
})

test('SMTP total deadline closes a stalled transport and never retries a delivery', async () => {
  let attempts = 0, closed = 0
  const send = createVerificationMailer({ SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: 'synthetic-mail-password', SMTP_FROM: 'sugar@example.invalid' },
    () => ({ sendMail: () => { attempts++; return new Promise(() => {}) }, close: () => { closed++ } }), 10)
  await assert.rejects(send({ email: 'test@example.invalid', language: 'es', url: 'https://example.invalid/#verify-email=synthetic' }), /Delivery timeout/)
  assert.equal(attempts, 1); assert.ok(closed >= 1)
})
