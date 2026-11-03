import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransaction } from './db.js'

function fixture({ rejectCommit = false } = {}) {
  const calls = [], failure = Error('Transaction failure')
  const transaction = createTransaction({ connect: async () => ({
    query: async (sql, args) => { calls.push([sql, args]); if (rejectCommit && sql === 'COMMIT') throw failure; return { rows: [{ id: 1 }] } },
    release: () => calls.push(['RELEASE']),
  }) })
  return { calls, failure, transaction }
}
test('transaction commits on the same connection and returns the callback result', async () => {
  const f = fixture()
  const result = await f.transaction(async tx => (await tx('SELECT $1', [7])).rows)
  assert.deepEqual(result, [{ id: 1 }])
  assert.deepEqual(f.calls, [['BEGIN', undefined], ['SELECT $1', [7]], ['COMMIT', undefined], ['RELEASE']])
})
test('transaction rolls back and releases the connection on callback or commit failure', async () => {
  for (const rejectCommit of [false, true]) {
    const f = fixture({ rejectCommit })
    await assert.rejects(f.transaction(async tx => { await tx('WRITE'); if (!rejectCommit) throw f.failure }), e => e === f.failure)
    assert.equal(f.calls.at(-2)[0], 'ROLLBACK')
    assert.equal(f.calls.at(-1)[0], 'RELEASE')
  }
})
