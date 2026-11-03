import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import bcrypt from '/app/node_modules/bcryptjs/index.js'
import { initDb, pool, q } from '/app/src/db.js'
import { encryptToken, decryptToken } from '/app/src/ai.js'

const [mode, expectedFile] = process.argv.slice(2)
const id = '10000000-0000-4000-8000-000000000001'
const image = '10000000-0000-4000-8000-000000000002'
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
try {
  if (mode === 'seed') {
    await initDb()
    await q('INSERT INTO projects(id,name,revision,yaml,created_by) VALUES($1,$2,1,$3,(SELECT id FROM users LIMIT 1))', [id, 'Synthetic recovery fixture', 'schema: 1\nname: Synthetic recovery fixture\nblocks: []\nconnections: []\n'])
    await q("INSERT INTO project_revisions(project_id,revision,yaml,summary) SELECT id,revision,yaml,'Synthetic revision' FROM projects WHERE id=$1", [id])
    await q("INSERT INTO images(id,name,mime,data,created_by,owner_id,scope) SELECT $1,'fixture.png','image/png',$2,id,id,'personal' FROM users LIMIT 1", [image, png])
    await q("INSERT INTO image_references VALUES($1,'project',$2,true)", [image, id])
    await q("INSERT INTO settings(key,value) VALUES('ai',$1)", [JSON.stringify({ provider: 'deepseek', token: encryptToken('synthetic-provider-token') })])
  }
  const tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows
  const hashes = {}
  for (const { tablename } of tables) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"'
    const rows = (await q(`SELECT to_jsonb(t)::text AS row FROM ${quoted} t ORDER BY to_jsonb(t)::text`)).rows
    hashes[tablename] = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  if (mode === 'seed') fs.writeFileSync(expectedFile, JSON.stringify(hashes), { mode: 0o600 })
  else {
    assert.equal(mode, 'verify')
    assert.deepEqual(hashes, JSON.parse(fs.readFileSync(expectedFile)))
    const user = (await q('SELECT * FROM users LIMIT 1')).rows[0]
    assert(await bcrypt.compare(process.env.ADMIN_PASSWORD, user.password_hash))
    assert.equal((await q('SELECT data FROM images WHERE id=$1', [image])).rows[0].data.equals(png), true)
    const config = (await q("SELECT value FROM settings WHERE key='ai'")).rows[0].value
    assert.equal(decryptToken(config.token), 'synthetic-provider-token')
    console.log('PASS all table rows, password verification, project history, image bytes and AI token recovery')
  }
} finally { await pool.end() }
