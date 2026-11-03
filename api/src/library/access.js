import { error } from '../shared/http.js'
import { canEdit, requireAdmin, requireEdit } from '../auth/policies.js'

export function libraryOwner(user, scope = user.role === 'Admin' ? 'catalog' : 'personal') {
  requireEdit(user)
  if (!['catalog', 'personal'].includes(scope)) error(400, 'Ámbito de biblioteca inválido')
  if (scope === 'catalog') { requireAdmin(user); return null }
  return user.id
}
export function requireLibraryAccess(item, user, edit = false, label = 'Bloque') {
  if (!item || (item.owner_id && item.owner_id !== user.id && user.role !== 'Admin')) error(404, label === 'Categoría' ? 'Categoría no encontrada' : 'Bloque no encontrado')
  if (edit) {
    requireEdit(user)
    if (!item.owner_id && user.role !== 'Admin') error(403, 'Solo un administrador puede modificar el catálogo compartido')
  }
  return item
}
export function libraryPermissions(item, user) {
  return { scope: item.owner_id ? 'personal' : 'catalog', canEdit: canEdit(user) && (user.role === 'Admin' || item.owner_id === user.id) }
}
