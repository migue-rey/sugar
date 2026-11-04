import test from 'node:test'
import assert from 'node:assert/strict'
import { takeAccountAction } from '../src/accountRecovery.ts'
test('account action fragments are removed without persisting tokens or putting them in query strings', () => {
  const token = 'ab'.repeat(32), calls = [], history = { replaceState: (...args) => calls.push(args) }
  for (const [fragment, kind] of [['reset-password', 'reset'], ['confirm-email', 'email_change']]) {
    assert.deepEqual(takeAccountAction({ hash: '#' + fragment + '=' + token, pathname: '/login', search: '?lang=en' }, history), { kind, token })
  }
  assert.deepEqual(calls, [[null, '', '/login?lang=en'], [null, '', '/login?lang=en']])
  assert.equal(takeAccountAction({ hash: '#other=x', pathname: '/', search: '' }, history), null)
  assert.equal(takeAccountAction({ hash: '#reset-password=x', pathname: '/', search: '' }, history).token, 'invalid')
  assert.equal(takeAccountAction({ hash: '#reset-password=' + token + '&confirm-email=' + token, pathname: '/', search: '' }, history).token, 'invalid')
})
