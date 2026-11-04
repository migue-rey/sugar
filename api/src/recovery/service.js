import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { registrationEmail } from '../registration/service.js'
import { error } from '../shared/http.js'
import { reportFailure } from '../shared/logging.js'

const digest = token => crypto.createHash('sha256').update(token).digest('hex')
const invalid = () => error(400, 'Enlace inválido o caducado / Invalid or expired link')
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) error(400, 'Datos inválidos / Invalid data')
}
function tokenHash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); return digest(value) }
function password(value, fresh = false) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > (fresh ? 72 : 1024) || (fresh && value.length < 12)) error(400, 'Contraseña inválida: la nueva requiere 12 caracteres y máximo 72 bytes / Invalid password: new passwords require 12 characters and at most 72 bytes')
  return value
}
function deliverable(email) { try { registrationEmail({ email }); return true } catch { return false } }

export function createRecoveryService({ repository, config, mail, runCredential = task => task() }) {
  const enabled = () => { if (!config.enabled) error(403, 'Recuperación deshabilitada / Account recovery disabled') }
  const notice = async (email, language, event) => {
    if (!deliverable(email)) return
    try { await mail.sendAccountMessage({ email, language, purpose: event }) }
    catch { reportFailure('Account notification failed', {}) }
  }
  let sending = 0
  const deliver = async task => {
    if (sending >= 2) throw Object.assign(Error('Inténtalo más tarde / Try again later'), { status: 429, retryAfter: 15 })
    sending++; try { return await task() } finally { sending-- }
  }
  return {
    enabled: config.enabled,
    async status(user) { const current = await repository.user(user.id); if (!current) error(401, 'Sesión inválida / Invalid session'); return { enabled: config.enabled, email: current.email, verified: !!current.email_verified_at } },
    async requestReset(input) {
      enabled()
      const { email, language } = registrationEmail(input)
      return deliver(async () => {
        const token = crypto.randomBytes(32).toString('hex'), hash = digest(token)
        if (!(await repository.reserve({ kind: 'reset', email, language, tokenHash: hash }))) return
        try { await mail.sendAccountMessage({ email, language, purpose: 'reset', url: config.origin + '/#reset-password=' + token }) }
        catch { await repository.discard(hash); reportFailure('Account delivery failed', {}) }
      })
    },
    async reset(input) {
      enabled(); fields(input, ['token', 'newPassword'])
      const hash = tokenHash(input.token), fresh = password(input.newPassword, true)
      if (!(await repository.lookup(hash, 'reset'))) invalid()
      const user = await runCredential(async () => repository.reset(hash, await bcrypt.hash(fresh, 12)))
      if (!user) invalid()
      await notice(user.email, user.language, 'password_changed')
      return user.id
    },
    async requestEmail(user, input) {
      enabled(); fields(input, ['email', 'currentPassword'])
      const email = registrationEmail({ email: input.email }).email, currentPassword = password(input.currentPassword)
      const current = await runCredential(async () => {
        const account = await repository.user(user.id)
        if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) error(400, 'Contraseña actual incorrecta / Incorrect current password')
        return account
      })
      return deliver(async () => {
        const token = crypto.randomBytes(32).toString('hex'), hash = digest(token)
        const dual = !!current.email_verified_at && current.email.toLowerCase() !== email
        const oldToken = dual ? crypto.randomBytes(32).toString('hex') : null
        if (!(await repository.reserve({ kind: 'email_change', email, language: current.language, user: current, tokenHash: hash, oldTokenHash: oldToken ? digest(oldToken) : null }))) return
        try {
          await mail.sendAccountMessage({ email, language: current.language, purpose: 'email_change', url: config.origin + '/#confirm-email=' + token })
          if (oldToken) await mail.sendAccountMessage({ email: current.email, language: current.language, purpose: 'email_change_old', newEmail: email, url: config.origin + '/#confirm-email=' + oldToken })
        } catch { await repository.discard(hash); reportFailure('Account delivery failed', {}) }
      })
    },
    async confirmEmail(input) {
      enabled(); fields(input, ['token', 'currentPassword'])
      const hash = tokenHash(input.token), currentPassword = password(input.currentPassword)
      const action = await repository.lookup(hash, 'email_change')
      if (!action?.user_id) invalid()
      let result
      try {
        result = await runCredential(async () => {
          const user = await repository.user(action.user_id)
          if (!user || user.auth_version !== action.auth_version || !(await bcrypt.compare(currentPassword, user.password_hash))) invalid()
          return repository.confirmEmail(hash, user.password_hash)
        })
      } catch (e) { if (e.code !== '23505') throw e; await repository.discard(hash); invalid() }
      if (!result) invalid()
      if (!result.pending) {
        await notice(result.email, result.language, 'email_changed')
        if (result.newEmail !== result.email) await notice(result.newEmail, result.language, 'email_changed')
      }
      return result
    },
    async passwordChanged(user) {
      if (!config.enabled) return
      try {
        const current = await repository.user(user.id)
        if (current?.email_verified_at) await notice(current.email, current.language, 'password_changed')
      } catch { reportFailure('Account notification failed', {}) }
    },
  }
}
