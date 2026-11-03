import { error } from '../shared/http.js'

export const canEdit = user => user.role === 'Admin' || user.role === 'dev'
export const requireEdit = user => { if (!canEdit(user)) error(403, 'Se requiere rol dev o Admin') }
export const requireAdmin = user => { if (user.role !== 'Admin') error(403, 'Se requiere rol Admin') }

export function requireProjectAccess(project, user, { edit = false, ownerOnly = false } = {}) {
  if (!project) error(404, 'Proyecto no encontrado')
  const owner = project.created_by === user.id || user.role === 'Admin'
  if (ownerOnly && !owner) error(403, 'Solo el creador o un administrador puede configurar este proyecto')
  const member = ['editor', 'reader'].includes(project.member_role)
  if (project.visibility === 'private' && !owner && !member) error(403, 'Proyecto privado')
  if (edit) {
    requireEdit(user)
    if (!owner && project.member_role !== 'editor') error(403, 'No tienes permiso para editar este proyecto')
  }
  return project
}

export function projectPermissions(project, user) {
  const owner = project.created_by === user.id || user.role === 'Admin'
  return { role: owner ? 'owner' : project.member_role || 'reader', canEdit: canEdit(user) && (owner || project.member_role === 'editor'), canManage: owner }
}
