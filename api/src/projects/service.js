import crypto from 'node:crypto'
import { createPatch } from 'diff'
import { error, requiredText } from '../shared/http.js'
import { requireAdmin, requireEdit, requireProjectAccess } from '../auth/policies.js'
import { normalizeColorLiterals, stringify, validateProject } from '../model.js'
import { repositorySettings } from './validation.js'

export function createProjectService({ projects, transaction, enqueue, categoryIcons, replaceEmbeddedImages }) {
  const get = async (id, user, options) => requireProjectAccess(await projects.find(id), user, options)
  const publicResult = async project => {
    const { id, name, yaml, revision, creator, visibility } = project
    return { id, name, yaml, revision, creator, visibility, category_icons: await categoryIcons(yaml) }
  }
  return {
    get,
    list: user => projects.list(user),
    async public(id) {
      const project = await projects.public(id)
      if (!project) error(404, 'Proyecto público no encontrado')
      return publicResult(project)
    },
    async shared(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) error(404, 'Enlace no encontrado')
      const project = await projects.shared(token)
      if (!project) error(404, 'Enlace no encontrado')
      return publicResult(project)
    },
    async create(user, input) {
      requireEdit(user)
      const yaml = normalizeColorLiterals(requiredText(input.yaml || stringify({ name: input.name || 'Nuevo proyecto', nodes: [], edges: [] }), 'YAML'))
      const project = validateProject(yaml), id = crypto.randomUUID()
      await transaction(async tx => {
        await projects.create(id, project.name, yaml, user.id, tx)
        await projects.addRevision(id, 1, yaml, user.id, input.summary || 'Proyecto creado', tx)
      })
      return { id, revision: 1 }
    },
    async settings(id, user, input) {
      const current = await get(id, user, { ownerOnly: true })
      const visibility = input.visibility
      if (!['public', 'private'].includes(visibility)) error(400, 'Visibilidad inválida')
      const { repository, branch } = repositorySettings(input)
      const expected = Number(input.expectedSettingsVersion)
      if (!Number.isInteger(expected) || expected < 1) error(400, 'Versión de configuración inválida')
      const before = { visibility: current.visibility, sync_repository: current.sync_repository, sync_branch: current.sync_branch }
      const after = { visibility, sync_repository: repository, sync_branch: branch }
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await transaction(async tx => {
          const saved = await projects.settings(id, expected, visibility, repository, branch, tx)
          if (!saved) error(409, 'La configuración cambió; recarga antes de guardar')
          await projects.addSettingsHistory(id, user.id, before, after, tx)
          const changedTarget = repository !== current.sync_repository || branch !== current.sync_branch
          if (changedTarget) await projects.skipPendingSync(id, tx)
          if (repository && changedTarget) await enqueue('project', id, saved.revision, saved.yaml, tx, { repository, branch })
        })
      }
      return get(id, user)
    },
    async settingsHistory(id, user) { await get(id, user); return projects.settingsHistory(id) },
    async share(id, user) {
      const project = await get(id, user, { ownerOnly: true })
      if (project.visibility === 'public') return { path: `/?public=${project.id}` }
      const token = await projects.share(project.id, crypto.randomBytes(32).toString('base64url'))
      return { path: `/?share=${token}` }
    },
    async revokeShare(id, user) { await get(id, user, { ownerOnly: true }); await projects.revokeShare(id) },
    async save(id, user, input) {
      const current = await get(id, user, { edit: true })
      const yaml = normalizeColorLiterals(requiredText(input.yaml, 'YAML')), project = validateProject(yaml), expected = Number(input.expectedRevision)
      if (!Number.isInteger(expected) || expected < 1) error(400, 'Revisión esperada inválida')
      const revision = await transaction(async tx => {
        const saved = await projects.save(id, expected, project.name, yaml, tx)
        if (!saved) error(409, 'El proyecto cambió; recarga antes de guardar')
        const revision = saved.revision
        await projects.addRevision(id, revision, yaml, user.id, input.summary || 'Proyecto actualizado', tx)
        if (current.sync_repository) await enqueue('project', id, revision, yaml, tx, { repository: current.sync_repository, branch: current.sync_branch })
        return revision
      })
      return { revision }
    },
    async archive(id, user) { requireAdmin(user); await get(id, user); await projects.archive(id) },
    async revisions(id, user) { await get(id, user); return projects.revisions(id) },
    async revision(id, user, revision) {
      await get(id, user)
      const saved = await projects.revision(id, revision)
      if (!saved) error(404, 'Revisión no encontrada')
      return saved.yaml
    },
    async diff(id, user, input) {
      await get(id, user)
      const a = Number(input.from), b = Number(input.to)
      if (!Number.isInteger(a) || !Number.isInteger(b)) error(400, 'Selecciona dos revisiones')
      const rows = await projects.comparison(id, a, b)
      const one = rows.find(r => r.revision === a), two = rows.find(r => r.revision === b)
      if (!one || !two) error(404, 'Revisión no encontrada')
      return createPatch('project.yaml', one.yaml, two.yaml, `revision ${a}`, `revision ${b}`)
    },
    async restore(id, user, input) {
      const current = await get(id, user, { edit: true })
      const wanted = Number(input.revision), expected = Number(input.expectedRevision)
      if (!Number.isInteger(wanted) || !Number.isInteger(expected)) error(400, 'Revisión inválida')
      const source = await projects.revision(id, wanted)
      if (!source) error(404, 'Revisión no encontrada')
      const revision = await transaction(async tx => {
        const yaml = normalizeColorLiterals(await replaceEmbeddedImages(source.yaml, 'project', tx))
        const doc = validateProject(yaml)
        const saved = await projects.save(id, expected, doc.name, yaml, tx)
        if (!saved) error(409, 'El proyecto cambió; recarga antes de restaurar')
        const revision = saved.revision
        await projects.addRevision(id, revision, yaml, user.id, `Restaurada revisión ${wanted}`, tx)
        if (current.sync_repository) await enqueue('project', id, revision, yaml, tx, { repository: current.sync_repository, branch: current.sync_branch })
        return revision
      })
      return { revision }
    },
  }
}
