import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { stringify } from './model.js'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
export const q = (sql, args = []) => pool.query(sql, args)
export async function transaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn((sql, args = []) => client.query(sql, args))
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally { client.release() }
}
export async function signingSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  await q("INSERT INTO settings(key,value) VALUES('jwt_secret',$1::jsonb) ON CONFLICT(key) DO NOTHING", [JSON.stringify(crypto.randomBytes(48).toString('base64url'))])
  return (await q("SELECT value FROM settings WHERE key='jwt_secret'")).rows[0].value
}
export async function initDb() {
  await q(`CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('view','dev','Admin')), language text NOT NULL DEFAULT 'es', theme text NOT NULL DEFAULT 'dark', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`)
  await q(`CREATE TABLE IF NOT EXISTS blocks (id uuid PRIMARY KEY, name text NOT NULL, latest_version integer NOT NULL DEFAULT 0, deleted_at timestamptz)`)
  await q(`CREATE TABLE IF NOT EXISTS block_versions (block_id uuid NOT NULL REFERENCES blocks(id), version integer NOT NULL, yaml text NOT NULL, author_id uuid REFERENCES users(id), summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(block_id, version))`)
  await q(`CREATE TABLE IF NOT EXISTS projects (id uuid PRIMARY KEY, name text NOT NULL, revision integer NOT NULL DEFAULT 0, yaml text NOT NULL, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id)`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('public','private'))`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token text UNIQUE`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sync_repository text`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS sync_branch text NOT NULL DEFAULT 'main'`)
  await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings_version integer NOT NULL DEFAULT 1`)
  await q(`CREATE TABLE IF NOT EXISTS project_revisions (project_id uuid NOT NULL REFERENCES projects(id), revision integer NOT NULL, yaml text NOT NULL, author_id uuid REFERENCES users(id), summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id, revision))`)
  await q(`UPDATE projects p SET created_by=(SELECT author_id FROM project_revisions r WHERE r.project_id=p.id ORDER BY revision LIMIT 1) WHERE p.created_by IS NULL`)
  await q(`CREATE TABLE IF NOT EXISTS project_settings_history (id bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), author_id uuid REFERENCES users(id), before jsonb NOT NULL, after jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
  await q(`CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL)`)
  await q(`CREATE TABLE IF NOT EXISTS sync_jobs (id bigserial PRIMARY KEY, kind text NOT NULL, record_id uuid NOT NULL, revision integer NOT NULL, yaml text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, error text, next_attempt_at timestamptz NOT NULL DEFAULT now(), commit_sha text, created_at timestamptz NOT NULL DEFAULT now())`)
  await q(`ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS target_repository text`)
  await q(`ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS target_branch text`)
  await q(`UPDATE sync_jobs SET status='skipped',error='Configura un repositorio en el proyecto para sincronizar' WHERE kind='project' AND target_repository IS NULL AND status='pending'`)
  const count = await q('SELECT count(*)::int AS n FROM users')
  if (count.rows[0].n === 0) {
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')
    const email = process.env.ADMIN_EMAIL || 'admin@local'
    await q('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), email.toLowerCase(), await bcrypt.hash(password, 12), 'Admin'])
    console.log(`Initial admin: ${email} / ${password}`)
    if (!process.env.ADMIN_PASSWORD) console.log('Save this generated password now; it is displayed only on first boot.')
  }
  const examples = await q('SELECT count(*)::int AS n FROM blocks')
  if (examples.rows[0].n === 0) {
    const templates = [
      { name: 'Sensor de temperatura', function: 'Medir temperatura', model: 'BME280', properties: { range: '-40..85 °C' }, ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 1 }, { id: 'power', label: 'Alimentación', protocol: 'POWER', direction: 'in', maxConnections: 1 }] },
      { name: 'Controlador', function: 'Procesar lecturas', model: 'MCU genérico', properties: {}, ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 16 }, { id: 'spi', label: 'SPI', protocol: 'SPI', direction: 'bidirectional', maxConnections: 4 }, { id: 'uart', label: 'UART', protocol: 'UART', direction: 'bidirectional', maxConnections: 2 }, { id: 'power', label: 'Alimentación', protocol: 'POWER', direction: 'in', maxConnections: 1 }] },
      { name: 'Fuente de alimentación', function: 'Proveer energía', model: '', properties: { voltage: '3.3 V' }, ports: [{ id: 'power', label: 'Salida', protocol: 'POWER', direction: 'out', maxConnections: 20 }] }
    ]
    for (const b of templates) {
      const id = crypto.randomUUID()
      await q('INSERT INTO blocks(id,name,latest_version) VALUES($1,$2,1)', [id, b.name])
      await q('INSERT INTO block_versions(block_id,version,yaml,summary) VALUES($1,1,$2,$3)', [id, stringify(b), 'Bloque inicial'])
    }
  }
}
