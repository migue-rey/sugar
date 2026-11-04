import test from 'node:test'
import assert from 'node:assert/strict'
import { emailFeatureConfig } from '../registration/config.js'
import { createRecoveryService } from './service.js'
import { createAccessControls, limitsConfig } from '../security/limits.js'
import { createAccountMailer } from '../registration/mail.js'
import { recoverySchemaReady } from './repository.js'

test('recovery activation is independent of registration and requires a canonical origin', () => {
  assert.deepEqual(emailFeatureConfig({ REGISTRATION_ENABLED: 'true' }, 'ACCOUNT_RECOVERY_ENABLED'), { enabled: false })
  assert.throws(() => emailFeatureConfig({ ACCOUNT_RECOVERY_ENABLED: 'true' }, 'ACCOUNT_RECOVERY_ENABLED'), { code: 'SECRET_CONFIG' })
  assert.deepEqual(emailFeatureConfig({ ACCOUNT_RECOVERY_ENABLED: 'true', PUBLIC_ORIGIN: 'http://localhost:8088' }, 'ACCOUNT_RECOVERY_ENABLED'), { enabled: true, origin: 'http://localhost:8088' })
})
test('disabled/malformed recovery and email mutations reject before SQL, bcrypt or transport', async () => {
  const unexpected = () => { throw Error('Unexpected dependency') }
  const disabled = createRecoveryService({ repository: {}, config: { enabled: false }, mail: {} })
  await assert.rejects(disabled.requestReset({ email: 'a@example.invalid' }), { status: 403 })
  await assert.rejects(disabled.reset({}), { status: 403 })
  await assert.rejects(disabled.requestEmail({}, {}), { status: 403 })
  const service = createRecoveryService({ repository: { lookup: unexpected }, config: { enabled: true }, mail: {}, runCredential: unexpected })
  for (const input of [null, { token: 'bad', newPassword: 'valid-test-password' }, { token: 'a'.repeat(64), newPassword: 'short' }, { token: 'a'.repeat(64), newPassword: 'á'.repeat(37) }, { token: 'a'.repeat(64), newPassword: 'valid-test-password', role: 'Admin' }]) await assert.rejects(service.reset(input), { status: 400 })
  await assert.rejects(service.confirmEmail({ token: 'bad', currentPassword: 'abc' }), { status: 400 })
  await assert.rejects(service.requestEmail({}, { email: 'a@example.invalid', currentPassword: 'abc', userId: 'other' }), { status: 400 })
})
test('recovery budgets cover IPv6 rotations, recipient spelling and shared outbound route capacity', () => {
  const controls = createAccessControls({ secret: 'synthetic-recovery-budget-secret', config: limitsConfig({}) })
  const call = (gate, req) => { let error; controls[gate](req, {}, e => { error = e }); return error }
  for (let i = 1; i <= 3; i++) assert.equal(call('recovery', { ip: '198.51.100.' + i, path: '/api/recovery/request', body: { email: ' SAME@EXAMPLE.INVALID ' } }), undefined)
  assert.equal(call('recovery', { ip: '198.51.100.4', path: '/api/recovery/request', body: { email: 'same@example.invalid' } }).status, 429)
  for (let i = 0; i < 20; i++) assert.equal(call('recovery', { ip: '2001:db8::1', path: '/api/recovery/reset' }), undefined)
  assert.equal(call('recovery', { ip: '2001:db8::2', path: '/api/recovery/confirm-email' }).status, 429)
})
test('security notifications fail without changing a successful credential result or leaking diagnostics', async t => {
  const logs = [], original = console.error
  console.error = (...args) => logs.push(args.join(' ')); t.after(() => { console.error = original })
  const service = createRecoveryService({ config: { enabled: true }, repository: { user: async () => { throw Error('private-password-and-address') } }, mail: {} })
  await service.passwordChanged({ id: 'synthetic' })
  assert.equal(logs.length, 1); assert.equal(logs.join('').includes('private-password-and-address'), false)
})
test('proof attempts on one secret link are bounded across different client addresses', () => {
  const controls = createAccessControls({ secret: 'synthetic-link-budget-secret', config: limitsConfig({}) })
  for (let i = 1; i <= 11; i++) {
    let failure
    controls.recovery({ ip: '198.51.100.' + i, path: '/api/recovery/confirm-email', body: { token: 'ab'.repeat(32) } }, {}, e => { failure = e })
    if (i <= 10) assert.equal(failure, undefined)
    else assert.equal(failure.status, 429)
  }
})
test('account mail uses fixed plain-text purposes with expiring links and no credentials in notifications', async () => {
  const messages = [], env = { SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'synthetic-user', SMTP_PASSWORD: 'invented-mail-password', SMTP_FROM: 'sugar@example.invalid' }
  const send = createAccountMailer(env, options => { assert.equal(options.requireTLS, true); return { sendMail: async message => messages.push(message), close: () => {} } })
  for (const language of ['es', 'en']) for (const purpose of ['reset', 'email_change', 'email_change_old', 'password_changed', 'email_changed']) {
    await send({ email: 'user@example.invalid', language, purpose, newEmail: 'new@example.invalid', ...(['reset','email_change','email_change_old'].includes(purpose) ? { url: 'https://example.invalid/#synthetic-link' } : {}) })
    const message = messages.at(-1)
    assert.equal(message.html, undefined); assert.equal(message.text.includes(env.SMTP_PASSWORD), false)
    if (['reset','email_change','email_change_old'].includes(purpose)) assert.match(message.text, /15/)
    else assert.equal(message.text.includes('#'), false)
  }
  await assert.rejects(send({ purpose: 'untrusted' }), { code: 'SECRET_CONFIG' })
})
test('recovery readiness checks a bounded capability marker without changing the compatible base version', async () => {
  for (const value of [undefined, 0, 1, 2]) assert.equal(await recoverySchemaReady(async query => {
    assert.equal(query.query_timeout, 1000); assert.match(query.text, /recovery_schema_version/)
    return { rows: value === undefined ? [] : [{ value }] }
  }), value === 1)
})
