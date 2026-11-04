import test from 'node:test'
import assert from 'node:assert/strict'
import { usePagedList } from '../src/pagination.ts'
test('gallery appends bounded pages, ignores double clicks and retains a failed page for retry', async () => {
  const requests = []; let resolve, fail = false
  const pages = usePagedList(async path => {
    requests.push(path)
    if (requests.length === 1) return { items: [{ id: 'one' }], nextCursor: 'first-cursor' }
    if (fail) throw Error('offline')
    return new Promise(r => { resolve = r })
  }, '/images/page')
  await pages.first(); assert.equal(pages.items.value.length, 1)
  const pending = pages.more(); await pages.more(); assert.equal(requests.length, 2)
  resolve({ items: [{ id: 'one' }, { id: 'two' }], nextCursor: 'second-cursor' }); await pending
  assert.deepEqual(pages.items.value.map(i => i.id), ['one', 'two'])
  fail = true; await assert.rejects(pages.more(), /offline/)
  assert.equal(pages.cursor.value, 'second-cursor'); assert.equal(pages.loading.value, false)
  fail = false; const retry = pages.more(); resolve({ items: [{ id: 'three' }], nextCursor: null }); await retry
  assert.equal(requests.at(-1), '/images/page?limit=30&cursor=second-cursor')
  const count = requests.length; await pages.more(); assert.equal(requests.length, count)
})
test('logout/account changes and newer refreshes discard both stale results and stale errors', async () => {
  const callbacks = []
  const pages = usePagedList(() => new Promise((resolve, reject) => callbacks.push({ resolve, reject })), '/images/page')
  const old = pages.first(); pages.reset()
  callbacks[0].resolve({ items: [{ id: 'private-old-account' }], nextCursor: 'old' }); await old
  assert.deepEqual(pages.items.value, []); assert.equal(pages.cursor.value, null)
  const stale = pages.first(), current = pages.first()
  callbacks[2].resolve({ items: [{ id: 'current-account' }], nextCursor: null }); await current
  callbacks[1].reject(Error('stale account failure')); await stale
  assert.deepEqual(pages.items.value, [{ id: 'current-account' }]); assert.equal(pages.loading.value, false)
})
