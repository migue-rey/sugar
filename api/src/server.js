import express from 'express'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { createPatch } from 'diff'
import { q, initDb, transaction, signingSecret } from './db.js'
import { validateBlock, validateProject, stringify, normalizeColorLiterals } from './model.js'
import { enqueue, startSync, syncOne } from './github.js'
import { imageBytes, replaceEmbeddedImages } from './images.js'

const app = express()
app.use(express.json({ limit: '3mb' }))
app.use(cookieParser())
app.disable('x-powered-by')
let secret = ''
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const error = (status, message) => { throw Object.assign(new Error(message), { status }) }
const canEdit = user => user.role === 'Admin' || user.role === 'dev'
const requireEdit = req => { if (!canEdit(req.user)) error(403, 'Se requiere rol dev o Admin') }
const requireAdmin = req => { if (req.user.role !== 'Admin') error(403, 'Se requiere rol Admin') }
const requiredText = (v, label) => { if (typeof v !== 'string' || !v.trim()) error(400, `${label} obligatorio`); return v.trim() }
const projectFields = `p.id,p.name,p.revision,p.yaml,p.visibility,p.created_by,p.sync_repository,p.sync_branch,p.settings_version,p.created_at,u.email AS creator`
const projectJoin = `FROM projects p LEFT JOIN users u ON u.id=p.created_by`
async function requireProject(req, edit = false, ownerOnly = false) {
  const { rows } = await q(`SELECT ${projectFields} ${projectJoin} WHERE p.id=$1 AND p.deleted_at IS NULL`, [req.params.id])
  const project = rows[0]
  if (!project) error(404, 'Proyecto no encontrado')
  const owner = project.created_by === req.user.id || req.user.role === 'Admin'
  if (ownerOnly && !owner) error(403, 'Solo el creador o un administrador puede configurar este proyecto')
  if (project.visibility === 'private' && !owner) error(403, 'Proyecto privado')
  if (edit) requireEdit(req)
  return project
}
function repositorySettings(body) {
  const repository = String(body.sync_repository || '').trim()
  const branch = String(body.sync_branch || 'main').trim()
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) error(400, 'Usa owner/repo para el repositorio')
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) error(400, 'Rama de GitHub inválida')
  return { repository: repository || null, branch }
}

app.get('/api/health', (_, res) => res.json({ ok: true }))
app.get('/api/images/:id/content', asyncRoute(async (req, res) => {
  const { rows } = await q('SELECT mime,data FROM images WHERE id=$1 AND deleted_at IS NULL', [req.params.id])
  if (!rows[0]) error(404, 'Imagen no encontrada')
  res.set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'public, max-age=3600').type(rows[0].mime).send(rows[0].data)
}))
app.get('/api/public/projects/:id', asyncRoute(async (req, res) => {
  const { rows } = await q(`SELECT ${projectFields} ${projectJoin} WHERE p.id=$1 AND p.visibility='public' AND p.deleted_at IS NULL`, [req.params.id])
  if (!rows[0]) error(404, 'Proyecto público no encontrado')
  const { id, name, yaml, revision, creator, visibility } = rows[0]
  res.json({ id, name, yaml, revision, creator, visibility })
}))
app.get('/api/shared/:token', asyncRoute(async (req, res) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.token)) error(404, 'Enlace no encontrado')
  const { rows } = await q(`SELECT ${projectFields} ${projectJoin} WHERE p.share_token=$1 AND p.deleted_at IS NULL`, [req.params.token])
  if (!rows[0]) error(404, 'Enlace no encontrado')
  const { id, name, yaml, revision, creator, visibility } = rows[0]
  res.json({ id, name, yaml, revision, creator, visibility })
}))
app.post('/api/login', asyncRoute(async (req, res) => {
  const { rows } = await q('SELECT * FROM users WHERE email=$1 AND active=true', [String(req.body.email || '').toLowerCase()])
  const user = rows[0]
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) error(401, 'Credenciales inválidas')
  res.cookie('session', jwt.sign({ id: user.id }, secret, { expiresIn: '7d' }), { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 604800000, path: '/' })
  res.json({ id: user.id, email: user.email, role: user.role, language: user.language, theme: user.theme })
}))
app.post('/api/logout', (_, res) => { res.clearCookie('session', { path: '/' }); res.json({ ok: true }) })
app.use('/api', asyncRoute(async (req, _res, next) => {
  try {
    const token = req.cookies.session
    if (!token) error(401, 'Sesión requerida')
    const payload = jwt.verify(token, secret)
    const { rows } = await q('SELECT id,email,role,language,theme FROM users WHERE id=$1 AND active=true', [payload.id])
    if (!rows[0]) error(401, 'Sesión inválida')
    req.user = rows[0]
    next()
  } catch (e) { next(e) }
}))

app.get('/api/images', asyncRoute(async (_req, res) => {
  const { rows } = await q('SELECT i.id,i.name,i.mime,i.created_at,u.email AS creator FROM images i LEFT JOIN users u ON u.id=i.created_by WHERE i.deleted_at IS NULL ORDER BY i.created_at DESC')
  res.json(rows.map(i => ({ ...i, url: `/api/images/${i.id}/content` })))
}))
app.post('/api/images', asyncRoute(async (req, res) => {
  requireEdit(req)
  const name = requiredText(req.body.name, 'Nombre').slice(0, 120)
  const mime = String(req.body.mime || '')
  const bytes = imageBytes(mime, req.body.data)
  const id = crypto.randomUUID()
  await q('INSERT INTO images(id,name,mime,data,created_by) VALUES($1,$2,$3,$4,$5)', [id, name, mime, bytes, req.user.id])
  res.status(201).json({ id, name, mime, url: `/api/images/${id}/content` })
}))
app.delete('/api/images/:id', asyncRoute(async (req, res) => {
  requireAdmin(req)
  const result = await q('UPDATE images SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [req.params.id])
  if (!result.rowCount) error(404, 'Imagen no encontrada')
  res.json({ ok: true })
}))
app.get('/api/me', (req, res) => res.json(req.user))
app.post('/api/validate', asyncRoute(async (req, res) => {
  if (req.body.kind === 'project') validateProject(req.body.yaml)
  else if (req.body.kind === 'block') validateBlock(req.body.yaml)
  else error(400, 'Tipo de documento inválido')
  res.json({ ok: true })
}))
app.patch('/api/me', asyncRoute(async (req, res) => {
  const language = req.body.language ?? null, theme = req.body.theme ?? null
  if ((language !== null && !['es', 'en'].includes(language)) || (theme !== null && !['dark', 'light'].includes(theme))) error(400, 'Preferencia inválida')
  const { rows } = await q('UPDATE users SET language=COALESCE($2,language),theme=COALESCE($3,theme) WHERE id=$1 RETURNING id,email,role,language,theme', [req.user.id, language, theme])
  res.json(rows[0])
}))
app.post('/api/me/password', asyncRoute(async (req, res) => {
  const old = requiredText(req.body.currentPassword, 'Contraseña actual'), fresh = requiredText(req.body.newPassword, 'Nueva contraseña')
  if (fresh.length < 12) error(400, 'La nueva contraseña debe tener al menos 12 caracteres')
  const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [req.user.id])
  if (!(await bcrypt.compare(old, rows[0].password_hash))) error(400, 'Contraseña actual incorrecta')
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(fresh, 12)])
  res.json({ ok: true })
}))

app.get('/api/users', asyncRoute(async (req, res) => { requireAdmin(req); res.json((await q('SELECT id,email,role,active,created_at FROM users ORDER BY email')).rows) }))
app.post('/api/users', asyncRoute(async (req, res) => {
  requireAdmin(req)
  const email = requiredText(req.body.email, 'Email').toLowerCase(), password = requiredText(req.body.password, 'Contraseña'), role = req.body.role
  if (password.length < 12 || !['view', 'dev', 'Admin'].includes(role)) error(400, 'Contraseña mínima de 12 caracteres y rol válido requeridos')
  const { rows } = await q('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,role,active', [crypto.randomUUID(), email, await bcrypt.hash(password, 12), role])
  res.status(201).json(rows[0])
}))
app.patch('/api/users/:id', asyncRoute(async (req, res) => {
  requireAdmin(req)
  if (!['view', 'dev', 'Admin'].includes(req.body.role)) error(400, 'Rol inválido')
  if (req.params.id === req.user.id) error(400, 'No puedes cambiar tu propio rol')
  const { rows } = await q('UPDATE users SET role=$2 WHERE id=$1 AND active=true RETURNING id,email,role,active', [req.params.id, req.body.role])
  if (!rows[0]) error(404, 'Usuario no encontrado')
  res.json(rows[0])
}))
app.delete('/api/users/:id', asyncRoute(async (req, res) => {
  requireAdmin(req)
  if (req.params.id === req.user.id) error(400, 'No puedes eliminar tu propia cuenta')
  await q('UPDATE users SET active=false WHERE id=$1', [req.params.id])
  res.json({ ok: true })
}))

app.get('/api/blocks', asyncRoute(async (_req, res) => {
  res.json((await q(`SELECT b.id,b.name,b.latest_version,v.yaml,v.created_at FROM blocks b JOIN block_versions v ON v.block_id=b.id AND v.version=b.latest_version WHERE b.deleted_at IS NULL ORDER BY b.name`)).rows)
}))
app.post('/api/blocks', asyncRoute(async (req, res) => {
  requireEdit(req)
  const yaml = normalizeColorLiterals(requiredText(req.body.yaml, 'YAML')), block = validateBlock(yaml), id = crypto.randomUUID(), summary = req.body.summary || 'Bloque creado'
  await transaction(async tx => {
    await tx('INSERT INTO blocks(id,name,latest_version) VALUES($1,$2,1)', [id, block.name])
    await tx('INSERT INTO block_versions(block_id,version,yaml,author_id,summary) VALUES($1,1,$2,$3,$4)', [id, yaml, req.user.id, summary])
    await enqueue('block', id, 1, yaml, tx)
  })
  res.status(201).json({ id, version: 1 })
}))
app.get('/api/blocks/:id/versions', asyncRoute(async (req, res) => {
  res.json((await q(`SELECT v.version,v.summary,v.created_at,u.email AS author FROM block_versions v LEFT JOIN users u ON u.id=v.author_id WHERE block_id=$1 ORDER BY version DESC`, [req.params.id])).rows)
}))
app.get('/api/blocks/:id/versions/:version', asyncRoute(async (req, res) => {
  const { rows } = await q('SELECT yaml FROM block_versions WHERE block_id=$1 AND version=$2', [req.params.id, req.params.version])
  if (!rows[0]) error(404, 'Versión no encontrada')
  res.type('text/yaml').send(rows[0].yaml)
}))
app.get('/api/blocks/:id/diff', asyncRoute(async (req, res) => {
  const a = Number(req.query.from), b = Number(req.query.to)
  if (!Number.isInteger(a) || !Number.isInteger(b)) error(400, 'Selecciona dos versiones')
  const { rows } = await q('SELECT version,yaml FROM block_versions WHERE block_id=$1 AND version=ANY($2::int[])', [req.params.id, [a, b]])
  const one = rows.find(r => r.version === a), two = rows.find(r => r.version === b)
  if (!one || !two) error(404, 'Versión no encontrada')
  res.type('text/plain').send(createPatch('block.yaml', one.yaml, two.yaml, `version ${a}`, `version ${b}`))
}))
app.post('/api/blocks/:id/restore', asyncRoute(async (req, res) => {
  requireEdit(req)
  const wanted = Number(req.body.version), expected = Number(req.body.expectedVersion)
  if (!Number.isInteger(wanted) || !Number.isInteger(expected)) error(400, 'Versión inválida')
  const { rows } = await q('SELECT yaml FROM block_versions WHERE block_id=$1 AND version=$2', [req.params.id, wanted])
  if (!rows[0]) error(404, 'Versión no encontrada')
  const version = await transaction(async tx => {
    const yaml = normalizeColorLiterals(await replaceEmbeddedImages(rows[0].yaml, 'block', tx))
    const block = validateBlock(yaml)
    const saved = await tx('UPDATE blocks SET name=$3,latest_version=latest_version+1 WHERE id=$1 AND latest_version=$2 AND deleted_at IS NULL RETURNING latest_version', [req.params.id, expected, block.name])
    if (!saved.rows[0]) error(409, 'El bloque cambió; recarga antes de restaurar')
    const version = saved.rows[0].latest_version
    await tx('INSERT INTO block_versions(block_id,version,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [req.params.id, version, yaml, req.user.id, `Restaurada versión ${wanted}`])
    await enqueue('block', req.params.id, version, yaml, tx)
    return version
  })
  res.json({ version })
}))
app.put('/api/blocks/:id', asyncRoute(async (req, res) => {
  requireEdit(req)
  const yaml = normalizeColorLiterals(requiredText(req.body.yaml, 'YAML')), block = validateBlock(yaml), expected = Number(req.body.expectedVersion)
  if (!Number.isInteger(expected) || expected < 1) error(400, 'Versión esperada inválida')
  const version = await transaction(async tx => {
    const { rows } = await tx('UPDATE blocks SET name=$3,latest_version=latest_version+1 WHERE id=$1 AND latest_version=$2 AND deleted_at IS NULL RETURNING latest_version', [req.params.id, expected, block.name])
    if (!rows[0]) error(409, 'El bloque cambió; recarga antes de guardar')
    const version = rows[0].latest_version
    await tx('INSERT INTO block_versions(block_id,version,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [req.params.id, version, yaml, req.user.id, req.body.summary || 'Bloque actualizado'])
    await enqueue('block', req.params.id, version, yaml, tx)
    return version
  })
  res.json({ version })
}))
app.delete('/api/blocks/:id', asyncRoute(async (req, res) => { requireAdmin(req); await q('UPDATE blocks SET deleted_at=now() WHERE id=$1', [req.params.id]); res.json({ ok: true }) }))

app.get('/api/projects', asyncRoute(async (req, res) => {
  res.json((await q(`SELECT p.id,p.name,p.revision,p.created_at,p.visibility,p.created_by,p.sync_repository,p.sync_branch,p.settings_version,u.email AS creator ${projectJoin} WHERE p.deleted_at IS NULL AND (p.visibility='public' OR p.created_by=$1 OR $2='Admin') ORDER BY p.name`, [req.user.id, req.user.role])).rows)
}))
app.post('/api/projects', asyncRoute(async (req, res) => {
  requireEdit(req)
  const yaml = normalizeColorLiterals(requiredText(req.body.yaml || stringify({ name: req.body.name || 'Nuevo proyecto', nodes: [], edges: [] }), 'YAML'))
  const project = validateProject(yaml), id = crypto.randomUUID()
  await transaction(async tx => {
    await tx('INSERT INTO projects(id,name,revision,yaml,created_by) VALUES($1,$2,1,$3,$4)', [id, project.name, yaml, req.user.id])
    await tx('INSERT INTO project_revisions(project_id,revision,yaml,author_id,summary) VALUES($1,1,$2,$3,$4)', [id, yaml, req.user.id, req.body.summary || 'Proyecto creado'])
  })
  res.status(201).json({ id, revision: 1 })
}))
app.patch('/api/projects/:id/settings', asyncRoute(async (req, res) => {
  const current = await requireProject(req, false, true)
  const visibility = req.body.visibility
  if (!['public', 'private'].includes(visibility)) error(400, 'Visibilidad inválida')
  const { repository, branch } = repositorySettings(req.body)
  const expected = Number(req.body.expectedSettingsVersion)
  if (!Number.isInteger(expected) || expected < 1) error(400, 'Versión de configuración inválida')
  const before = { visibility: current.visibility, sync_repository: current.sync_repository, sync_branch: current.sync_branch }
  const after = { visibility, sync_repository: repository, sync_branch: branch }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await transaction(async tx => {
      const { rows } = await tx('UPDATE projects SET share_token=CASE WHEN visibility IS DISTINCT FROM $3 THEN NULL ELSE share_token END,visibility=$3,sync_repository=$4,sync_branch=$5,settings_version=settings_version+1 WHERE id=$1 AND settings_version=$2 AND deleted_at IS NULL RETURNING revision,yaml', [req.params.id, expected, visibility, repository, branch])
      if (!rows[0]) error(409, 'La configuración cambió; recarga antes de guardar')
      await tx('INSERT INTO project_settings_history(project_id,author_id,before,after) VALUES($1,$2,$3::jsonb,$4::jsonb)', [req.params.id, req.user.id, JSON.stringify(before), JSON.stringify(after)])
      if (repository !== current.sync_repository || branch !== current.sync_branch) await tx("UPDATE sync_jobs SET status='skipped',error='Destino de sincronización cambiado' WHERE kind='project' AND record_id=$1 AND status='pending'", [req.params.id])
      if (repository && (repository !== current.sync_repository || branch !== current.sync_branch)) await enqueue('project', req.params.id, rows[0].revision, rows[0].yaml, tx, { repository, branch })
    })
  }
  res.json(await requireProject(req))
}))
app.get('/api/projects/:id/settings/history', asyncRoute(async (req, res) => {
  await requireProject(req)
  res.json((await q('SELECT h.before,h.after,h.created_at,u.email AS author FROM project_settings_history h LEFT JOIN users u ON u.id=h.author_id WHERE h.project_id=$1 ORDER BY h.id DESC', [req.params.id])).rows)
}))
app.post('/api/projects/:id/share', asyncRoute(async (req, res) => {
  const project = await requireProject(req, false, true)
  if (project.visibility === 'public') return res.json({ path: `/?public=${project.id}` })
  const token = crypto.randomBytes(32).toString('base64url')
  const { rows } = await q('UPDATE projects SET share_token=COALESCE(share_token,$2) WHERE id=$1 AND deleted_at IS NULL RETURNING share_token', [project.id, token])
  res.json({ path: `/?share=${rows[0].share_token}` })
}))
app.delete('/api/projects/:id/share', asyncRoute(async (req, res) => {
  await requireProject(req, false, true)
  await q('UPDATE projects SET share_token=NULL WHERE id=$1', [req.params.id])
  res.json({ ok: true })
}))
app.get('/api/projects/:id/sync', asyncRoute(async (req, res) => {
  await requireProject(req)
  res.json((await q("SELECT revision,status,attempts,error,commit_sha,created_at,target_repository,target_branch FROM sync_jobs WHERE kind='project' AND record_id=$1 ORDER BY id DESC LIMIT 10", [req.params.id])).rows)
}))
app.post('/api/projects/:id/sync/retry', asyncRoute(async (req, res) => {
  await requireProject(req, false, true)
  await q("UPDATE sync_jobs SET next_attempt_at=now() WHERE kind='project' AND record_id=$1 AND status='pending'", [req.params.id])
  syncOne().catch(console.error)
  res.json({ ok: true })
}))
app.get('/api/projects/:id', asyncRoute(async (req, res) => {
  res.json(await requireProject(req))
}))
app.get('/api/projects/:id/export', asyncRoute(async (req, res) => {
  const project = await requireProject(req)
  res.set('Content-Disposition', `attachment; filename="${req.params.id}.yaml"`).type('text/yaml').send(project.yaml)
}))
app.put('/api/projects/:id', asyncRoute(async (req, res) => {
  const current = await requireProject(req, true)
  const yaml = normalizeColorLiterals(requiredText(req.body.yaml, 'YAML')), project = validateProject(yaml), expected = Number(req.body.expectedRevision)
  if (!Number.isInteger(expected) || expected < 1) error(400, 'Revisión esperada inválida')
  const revision = await transaction(async tx => {
    const { rows } = await tx('UPDATE projects SET name=$3,yaml=$4,revision=revision+1 WHERE id=$1 AND revision=$2 AND deleted_at IS NULL RETURNING revision', [req.params.id, expected, project.name, yaml])
    if (!rows[0]) error(409, 'El proyecto cambió; recarga antes de guardar')
    const revision = rows[0].revision
    await tx('INSERT INTO project_revisions(project_id,revision,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [req.params.id, revision, yaml, req.user.id, req.body.summary || 'Proyecto actualizado'])
    if (current.sync_repository) await enqueue('project', req.params.id, revision, yaml, tx, { repository: current.sync_repository, branch: current.sync_branch })
    return revision
  })
  res.json({ revision })
}))
app.delete('/api/projects/:id', asyncRoute(async (req, res) => { requireAdmin(req); await requireProject(req); await q('UPDATE projects SET deleted_at=now() WHERE id=$1', [req.params.id]); res.json({ ok: true }) }))
app.get('/api/projects/:id/revisions', asyncRoute(async (req, res) => {
  await requireProject(req)
  res.json((await q(`SELECT r.revision,r.summary,r.created_at,u.email AS author FROM project_revisions r LEFT JOIN users u ON u.id=r.author_id WHERE project_id=$1 ORDER BY revision DESC`, [req.params.id])).rows)
}))
app.get('/api/projects/:id/revisions/:revision', asyncRoute(async (req, res) => {
  await requireProject(req)
  const { rows } = await q('SELECT yaml FROM project_revisions WHERE project_id=$1 AND revision=$2', [req.params.id, req.params.revision])
  if (!rows[0]) error(404, 'Revisión no encontrada')
  res.type('text/yaml').send(rows[0].yaml)
}))
app.get('/api/projects/:id/diff', asyncRoute(async (req, res) => {
  await requireProject(req)
  const a = Number(req.query.from), b = Number(req.query.to)
  if (!Number.isInteger(a) || !Number.isInteger(b)) error(400, 'Selecciona dos revisiones')
  const { rows } = await q('SELECT revision,yaml FROM project_revisions WHERE project_id=$1 AND revision=ANY($2::int[])', [req.params.id, [a, b]])
  const one = rows.find(r => r.revision === a), two = rows.find(r => r.revision === b)
  if (!one || !two) error(404, 'Revisión no encontrada')
  res.type('text/plain').send(createPatch('project.yaml', one.yaml, two.yaml, `revision ${a}`, `revision ${b}`))
}))
app.post('/api/projects/:id/restore', asyncRoute(async (req, res) => {
  const current = await requireProject(req, true)
  const wanted = Number(req.body.revision), expected = Number(req.body.expectedRevision)
  if (!Number.isInteger(wanted) || !Number.isInteger(expected)) error(400, 'Revisión inválida')
  const { rows } = await q('SELECT yaml FROM project_revisions WHERE project_id=$1 AND revision=$2', [req.params.id, wanted])
  if (!rows[0]) error(404, 'Revisión no encontrada')
  const revision = await transaction(async tx => {
    const yaml = normalizeColorLiterals(await replaceEmbeddedImages(rows[0].yaml, 'project', tx))
    const doc = validateProject(yaml)
    const saved = await tx('UPDATE projects SET name=$3,yaml=$4,revision=revision+1 WHERE id=$1 AND revision=$2 AND deleted_at IS NULL RETURNING revision', [req.params.id, expected, doc.name, yaml])
    if (!saved.rows[0]) error(409, 'El proyecto cambió; recarga antes de restaurar')
    const revision = saved.rows[0].revision
    await tx('INSERT INTO project_revisions(project_id,revision,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [req.params.id, revision, yaml, req.user.id, `Restaurada revisión ${wanted}`])
    if (current.sync_repository) await enqueue('project', req.params.id, revision, yaml, tx, { repository: current.sync_repository, branch: current.sync_branch })
    return revision
  })
  res.json({ revision })
}))

app.get('/api/github', asyncRoute(async (req, res) => {
  requireAdmin(req)
  const { rows } = await q("SELECT value FROM settings WHERE key='github'")
  res.json({ config: rows[0]?.value || null, credentialsReady: Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_INSTALLATION_ID && process.env.GITHUB_PRIVATE_KEY) })
}))
app.put('/api/github', asyncRoute(async (req, res) => {
  requireAdmin(req)
  const owner = requiredText(req.body.owner, 'Organización o usuario'), repo = requiredText(req.body.repo, 'Repositorio'), branch = requiredText(req.body.branch || 'main', 'Rama')
  if (![owner, repo, branch].every(x => /^[A-Za-z0-9._/-]+$/.test(x))) error(400, 'Repositorio o rama inválidos')
  await q("INSERT INTO settings(key,value) VALUES('github',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify({ owner, repo, branch })])
  res.json({ owner, repo, branch })
}))
app.get('/api/github/status', asyncRoute(async (req, res) => {
  const { rows } = await q("SELECT status,count(*)::int AS count FROM sync_jobs GROUP BY status")
  const recent = (await q('SELECT id,kind,record_id,revision,status,attempts,error,commit_sha FROM sync_jobs ORDER BY id DESC LIMIT 20')).rows
  res.json({ counts: rows, recent })
}))
app.post('/api/github/retry', asyncRoute(async (req, res) => {
  requireAdmin(req)
  await q("UPDATE sync_jobs SET next_attempt_at=now() WHERE status='pending'")
  syncOne().catch(console.error)
  res.json({ ok: true })
}))

app.use((err, _req, res, _next) => {
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese nombre o identificador' })
  if (err.code === '22P02') return res.status(400).json({ error: 'Identificador inválido' })
  const status = err.status || (err.name === 'JsonWebTokenError' ? 401 : 500)
  if (status === 500) console.error(err)
  res.status(status).json({ error: status === 500 ? 'Error interno' : err.message })
})

for (let attempt = 1; ; attempt++) {
  try { await initDb(); break }
  catch (e) {
    if (attempt >= 30) throw e
    console.warn(`Database not ready (${attempt}/30); retrying`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
secret = await signingSecret()
startSync()
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('API ready'))
