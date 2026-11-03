// Reproduce the previous init-on-start contract using only disposable fixture data.
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { q, initDb, pool, transaction, signingSecret } from '/app/src/db.js'
import { verifyRuntime } from '/app/src/database/access.js'
import { createApp } from '/app/src/app.js'
const id = '20000000-0000-4000-8000-000000000001'
async function digest() {
  const rows = []
  for (const sql of [
    'SELECT * FROM projects WHERE id=$1', 'SELECT * FROM project_revisions WHERE project_id=$1',
    'SELECT * FROM images WHERE id=$1', 'SELECT id,email,password_hash FROM users ORDER BY id',
  ]) rows.push((await q(sql, sql.includes('$1') ? [id] : [])).rows)
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}
try {
  const before = process.argv[2] === 'rollback' ? await digest() : null
  await initDb()
  if (process.argv[2] === 'seed') {
    await q("INSERT INTO projects(id,name,yaml,revision,created_by) SELECT $1,'Legacy fixture','name: Legacy fixture\nnodes: []\nedges: []\n',1,id FROM users LIMIT 1", [id])
    await q("INSERT INTO project_revisions(project_id,revision,yaml,summary) SELECT id,revision,yaml,'Legacy fixture' FROM projects WHERE id=$1", [id])
    await q("INSERT INTO images(id,name,mime,data,created_by,owner_id) SELECT $1,'Legacy bytes','image/png',$2,id,id FROM users LIMIT 1", [id, Buffer.from('89504e470d0a1a0a', 'hex')])
  } else {
    await assert.rejects(verifyRuntime(q), { code: 'DATABASE_CONFIG' })
    const app = createApp({ q, transaction, secret: await signingSecret(), enqueue: async () => {}, syncOne: async () => {} })
    const server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).status, 200) }
    finally { await new Promise(resolve => server.close(resolve)) }
    assert.equal(await digest(), before)
    await q('CREATE TABLE IF NOT EXISTS future_privilege_fixture(id serial PRIMARY KEY,value text)')
  }
  console.log('LEGACY_DIGEST=' + await digest())
} finally { await pool.end() }
