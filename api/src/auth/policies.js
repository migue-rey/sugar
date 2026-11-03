import { error } from '../shared/http.js'

export const canEdit = user => user.role === 'Admin' || user.role === 'dev'
export const requireEdit = user => { if (!canEdit(user)) error(403, 'Se requiere rol dev o Admin') }
export const requireAdmin = user => { if (user.role !== 'Admin') error(403, 'Se requiere rol Admin') }

export function requireProjectAccess(project, user, { edit = false, ownerOnly = false } = {}) {
  if (!project) error(404, 'Proyecto no encontrado')
  const owner = project.created_by === user.id || user.role === 'Admin'
  if (ownerOnly && !owner) error(403, 'Solo el creador o un administrador puede configurar este proyecto')
  if (project.visibility === 'private' && !owner) error(403, 'Proyecto privado')
  if (edit) requireEdit(user)
  return project
}
