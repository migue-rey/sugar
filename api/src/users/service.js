import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { error, requiredText } from '../shared/http.js'
import { requireAdmin } from '../auth/policies.js'

export function createUserService(users) {
  return {
    async preferences(user, input) {
      const language = input.language ?? null, theme = input.theme ?? null
      if ((language !== null && !['es', 'en'].includes(language)) || (theme !== null && !['dark', 'light'].includes(theme))) error(400, 'Preferencia inválida')
      return users.preferences(user.id, language, theme)
    },
    async password(user, input) {
      const old = requiredText(input.currentPassword, 'Contraseña actual'), fresh = requiredText(input.newPassword, 'Nueva contraseña')
      if (fresh.length < 12) error(400, 'La nueva contraseña debe tener al menos 12 caracteres')
      if (!(await bcrypt.compare(old, await users.passwordHash(user.id)))) error(400, 'Contraseña actual incorrecta')
      await users.password(user.id, await bcrypt.hash(fresh, 12))
    },
    async list(user) { requireAdmin(user); return users.list() },
    async create(user, input) {
      requireAdmin(user)
      const email = requiredText(input.email, 'Email').toLowerCase(), password = requiredText(input.password, 'Contraseña'), role = input.role
      if (password.length < 12 || !['view', 'dev', 'Admin'].includes(role)) error(400, 'Contraseña mínima de 12 caracteres y rol válido requeridos')
      return users.create(crypto.randomUUID(), email, await bcrypt.hash(password, 12), role)
    },
    async role(user, id, input) {
      requireAdmin(user)
      if (!['view', 'dev', 'Admin'].includes(input.role)) error(400, 'Rol inválido')
      if (id === user.id) error(400, 'No puedes cambiar tu propio rol')
      const saved = await users.role(id, input.role)
      if (!saved) error(404, 'Usuario no encontrado')
      return saved
    },
    async archive(user, id) {
      requireAdmin(user)
      if (id === user.id) error(400, 'No puedes eliminar tu propia cuenta')
      await users.archive(id)
    },
  }
}
