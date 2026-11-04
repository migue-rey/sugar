import test from 'node:test'
import assert from 'node:assert/strict'
import { takeVerificationToken } from '../src/registration.ts'
test('verification links are removed before use, preserve route/query, and never use storage', () => {
  const token = 'ab'.repeat(32), calls = [], history = { replaceState: (...args) => calls.push(args) }
  assert.equal(takeVerificationToken({ hash: '#verify-email=' + token, pathname: '/', search: '?lang=en' }, history), token)
  assert.deepEqual(calls, [[null, '', '/?lang=en']])
  calls.length = 0
  assert.equal(takeVerificationToken({ hash: '#other=123', pathname: '/', search: '' }, history), '')
  assert.equal(calls.length, 0)
  assert.equal(takeVerificationToken({ hash: '#verify-email=malformed', pathname: '/', search: '' }, history), 'invalid')
  assert.deepEqual(calls, [[null, '', '/']])
})
