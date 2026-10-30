import pg from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { stringify } from './model.js'
import { replaceEmbeddedImages } from './images.js'

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
  await q(`CREATE TABLE IF NOT EXISTS images (id uuid PRIMARY KEY, name text NOT NULL, mime text NOT NULL, data bytea NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)` )
  await q(`CREATE TABLE IF NOT EXISTS blocks (id uuid PRIMARY KEY, name text NOT NULL, latest_version integer NOT NULL DEFAULT 0, deleted_at timestamptz)`)
  await q(`CREATE TABLE IF NOT EXISTS block_categories (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, name_key text NOT NULL, parent_id uuid REFERENCES block_categories(id), deleted_at timestamptz)`)
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS block_categories_sibling_name ON block_categories (coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),name_key) WHERE deleted_at IS NULL`)
  await q(`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS category_slug text`)
  await q(`ALTER TABLE blocks ADD COLUMN IF NOT EXISTS subcategory_slug text`)
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
  // Convert current documents once; historical revisions remain intact for audit.
  for (const row of (await q("SELECT id,revision,yaml,sync_repository,sync_branch FROM projects WHERE deleted_at IS NULL AND yaml LIKE '%data:image/%'")).rows) {
    await transaction(async tx => {
      const yaml = await replaceEmbeddedImages(row.yaml, 'project', tx)
      if (yaml === row.yaml) return
      const revision = row.revision + 1
      await tx('UPDATE projects SET yaml=$2,revision=$3 WHERE id=$1', [row.id, yaml, revision])
      await tx('INSERT INTO project_revisions(project_id,revision,yaml,summary) VALUES($1,$2,$3,$4)', [row.id, revision, yaml, 'Imágenes trasladadas a la galería'])
    })
  }
  for (const row of (await q("SELECT b.id,b.latest_version,v.yaml FROM blocks b JOIN block_versions v ON v.block_id=b.id AND v.version=b.latest_version WHERE b.deleted_at IS NULL AND v.yaml LIKE '%data:image/%'")).rows) {
    await transaction(async tx => {
      const yaml = await replaceEmbeddedImages(row.yaml, 'block', tx)
      if (yaml === row.yaml) return
      const version = row.latest_version + 1
      await tx('UPDATE blocks SET latest_version=$2 WHERE id=$1', [row.id, version])
      await tx('INSERT INTO block_versions(block_id,version,yaml,summary) VALUES($1,$2,$3,$4)', [row.id, version, yaml, 'Imagen trasladada a la galería'])
    })
  }
  const examples = await q('SELECT count(*)::int AS n FROM blocks')
  const categoryCount = await q('SELECT count(*)::int AS n FROM block_categories')
  if (categoryCount.rows[0].n === 0) {
    const roots = [
      ['sensores', 'Sensores', 'temperatura', 'Temperatura'],
      ['controladores', 'Controladores', 'mcu', 'MCU'],
      ['alimentacion', 'Alimentación', 'fuentes', 'Fuentes'],
    ]
    for (const [slug, name, childSlug, childName] of roots) {
      const id = crypto.randomUUID()
      await q('INSERT INTO block_categories(id,slug,name,name_key) VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO NOTHING', [id, slug, name, name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()])
      const root = (await q('SELECT id FROM block_categories WHERE slug=$1', [slug])).rows[0]
      await q('INSERT INTO block_categories(id,slug,name,name_key,parent_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO NOTHING', [crypto.randomUUID(), childSlug, childName, childName.toLowerCase(), root.id])
    }
  }
  if (examples.rows[0].n === 0) {
    const templates = [
      { name: 'Sensor de temperatura', function: 'Medir temperatura', model: 'BME280', category: 'sensores', subcategory: 'temperatura', properties: { range: '-40..85 °C' }, ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 1 }, { id: 'power', label: 'Alimentación', protocol: 'POWER', direction: 'in', maxConnections: 1 }] },
      { name: 'Controlador', function: 'Procesar lecturas', model: 'MCU genérico', category: 'controladores', subcategory: 'mcu', properties: {}, ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 16 }, { id: 'spi', label: 'SPI', protocol: 'SPI', direction: 'bidirectional', maxConnections: 4 }, { id: 'uart', label: 'UART', protocol: 'UART', direction: 'bidirectional', maxConnections: 2 }, { id: 'power', label: 'Alimentación', protocol: 'POWER', direction: 'in', maxConnections: 1 }] },
      { name: 'Fuente de alimentación', function: 'Proveer energía', model: '', category: 'alimentacion', subcategory: 'fuentes', properties: { voltage: '3.3 V' }, ports: [{ id: 'power', label: 'Salida', protocol: 'POWER', direction: 'out', maxConnections: 20 }] }
    ]
    for (const b of templates) {
      const id = crypto.randomUUID()
      await q('INSERT INTO blocks(id,name,latest_version,category_slug,subcategory_slug) VALUES($1,$2,1,$3,$4)', [id, b.name, b.category, b.subcategory])
      await q('INSERT INTO block_versions(block_id,version,yaml,summary) VALUES($1,1,$2,$3)', [id, stringify(b), 'Bloque inicial'])
    }
  }
}
