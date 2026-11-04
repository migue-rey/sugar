import test from 'node:test'
import assert from 'node:assert/strict'
import { pageInput, pageResult } from './pagination.js'
import { createImageService } from '../images/service.js'
test('page validation rejects unbounded/coerced input before querying and preserves microsecond cursors', async () => {
  assert.deepEqual(pageInput(), { limit: 30, after: null })
  const unexpected = () => { throw Error('Unexpected SQL') }, service = createImageService({ page: unexpected })
  for (const input of [{ limit: '0' }, { limit: '-1' }, { limit: '101' }, { limit: '1e2' }, { limit: ['2'] }, { limit: '01' }, { cursor: 'a'.repeat(257) }, { cursor: Buffer.from('{}').toString('base64url') }, { extra: 'x' }]) await assert.rejects(service.page({}, input), { status: 400 })
  const row = { id: '11111111-1111-1111-1111-111111111111', cursor_time: '2026-01-01T00:00:00.123456Z' }
  const result = pageResult([row, row], 1, value => value)
  assert.deepEqual(pageInput({ limit: '100', cursor: result.nextCursor }).after, { at: row.cursor_time, id: row.id })
  assert.equal(result.items[0].cursor_time, undefined)
  for (const at of ['0000-01-01T00:00:00.123456Z','2026-02-30T00:00:00.123456Z','2026-01-01T24:00:00.123456Z']) assert.throws(() => pageInput({ cursor: Buffer.from(JSON.stringify({ at, id: row.id })).toString('base64url') }), { status: 400 })
})
