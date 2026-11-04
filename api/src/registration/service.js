import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { error } from '../shared/http.js'
import { reportFailure } from '../shared/logging.js'

const digest = token => crypto.createHash('sha256').update(token).digest('hex')
function fields(input, allowed) {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key))) error(400, 'Datos de registro inválidos / Invalid registration data')
}
export function registrationEmail(input) {
  fields(input, ['email', 'language'])
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)) error(400, 'Correo inválido / Invalid email')
  if (input.language !== undefined && !['es', 'en'].includes(input.language)) error(400, 'Idioma inválido / Invalid language')
  return { email, language: input.language || 'es' }
}
export function createRegistrationService({ repository, config, sendVerification, runCredential = task => task() }) {
  if (config.enabled && typeof sendVerification !== 'function') throw Object.assign(Error('Registration transport is required'), { code: 'SECRET_CONFIG' })
  const available = () => { if (!config.enabled) error(403, 'Registro deshabilitado / Registration disabled') }
  let sending = 0
  return {
    enabled: config.enabled,
    async request(input) {
      available()
      const { email, language } = registrationEmail(input)
      if (sending >= 2) throw Object.assign(Error('Inténtalo más tarde / Try again later'), { status: 429, retryAfter: 15 })
      sending++
      try {
        const token = crypto.randomBytes(32).toString('hex'), tokenHash = digest(token)
        if (!(await repository.reserve(email, tokenHash, language))) return
        try {
          // Identical flow for existing, inactive and unknown accounts: no account lookup here.
          await sendVerification({ email, language, url: config.origin + '/#verify-email=' + token })
        } catch {
          await repository.discard(tokenHash)
          reportFailure('Registration delivery failed', {})
        }
      } finally { sending-- }
    },
    async verify(input) {
      available(); fields(input, ['token', 'password'])
      const { token, password } = input
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) error(400, 'Enlace inválido o caducado / Invalid or expired link')
      if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) error(400, 'Contraseña: mínimo 12 caracteres y máximo 72 bytes / Password: 12 characters minimum, 72 bytes maximum')
      const tokenHash = digest(token)
      if (!(await repository.valid(tokenHash))) error(400, 'Enlace inválido o caducado / Invalid or expired link')
      return runCredential(async () => {
        const id = await repository.consume(tokenHash, crypto.randomUUID(), await bcrypt.hash(password, 12))
        if (!id) error(400, 'Enlace inválido o caducado / Invalid or expired link')
        return id
      })
    },
  }
}
