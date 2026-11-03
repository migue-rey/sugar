import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { error } from '../shared/http.js'

export function createAuthService({ users, secret }) {
  return {
    async login(input) {
      const user = await users.findActiveByEmail(String(input.email || '').toLowerCase())
      if (!user || !(await bcrypt.compare(String(input.password || ''), user.password_hash))) error(401, 'Credenciales inválidas')
      return {
        token: jwt.sign({ id: user.id }, secret, { expiresIn: '7d' }),
        user: { id: user.id, email: user.email, role: user.role, language: user.language, theme: user.theme },
      }
    },
    async authenticate(token) {
      if (!token) error(401, 'Sesión requerida')
      const payload = jwt.verify(token, secret)
      const user = await users.findActiveById(payload.id)
      if (!user) error(401, 'Sesión inválida')
      return user
    },
  }
}
