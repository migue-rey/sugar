import crypto from 'node:crypto'
import { smtpOptions, createVerificationMailer, verifySmtp } from '../registration/mail.js'
import { configError } from '../config/secrets.js'
import { error } from '../shared/http.js'

const aad = Buffer.from('sugar.smtp.password.v1')
function key(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.MAIL_ENCRYPTION_KEY || '')) throw configError('MAIL_ENCRYPTION_KEY')
  return Buffer.from(env.MAIL_ENCRYPTION_KEY, 'hex')
}
function encrypt(value, env) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(env), iv)
  cipher.setAAD(aad)
  return { iv: iv.toString('hex'), data: Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex'), tag: cipher.getAuthTag().toString('hex') }
}
function decrypt(value, env) {
  try {
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(env), Buffer.from(value.iv, 'hex'))
    cipher.setAAD(aad); cipher.setAuthTag(Buffer.from(value.tag, 'hex'))
    return Buffer.concat([cipher.update(Buffer.from(value.data, 'hex')), cipher.final()]).toString('utf8')
  } catch { throw configError('MAIL_ENCRYPTION_KEY') }
}
function validate(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !['host','port','username','from','password','clearPassword'].includes(k))) error(400, 'Configuración SMTP inválida / Invalid SMTP configuration')
  for (const field of ['host', 'username', 'from']) if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 254 || /[\r\n\0]/.test(input[field])) error(400, 'Configuración SMTP inválida / Invalid SMTP configuration')
  if (typeof input.port !== 'number' || ![465, 587].includes(input.port) || (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 4096 || /[\r\n\0]/.test(input.password))) || (input.clearPassword !== undefined && typeof input.clearPassword !== 'boolean') || (input.clearPassword && input.password)) error(400, 'Configuración SMTP inválida / Invalid SMTP configuration')
  const fields = { host: input.host.trim(), port: input.port, username: input.username.trim(), from: input.from.trim() }
  try { smtpOptions(asEnv({ ...fields, password: 'validation-only' })) } catch { error(400, 'Configuración SMTP inválida / Invalid SMTP configuration') }
  return fields
}
function asEnv(config) { return { SMTP_HOST: config.host, SMTP_PORT: config.port, SMTP_USER: config.username, SMTP_FROM: config.from, SMTP_PASSWORD: config.password } }

export function createMailService({ q, env = process.env, transportFactory }) {
  let testing = false
  const saved = async () => (await q("SELECT value FROM settings WHERE key='mail_config'")).rows[0]?.value
  const fallback = () => ({ host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), username: env.SMTP_USER || '', from: env.SMTP_FROM || '', password: env.SMTP_PASSWORD || '' })
  const privateConfig = async () => {
    const value = await saved()
    return value ? { ...value, password: value.password_enc ? decrypt(value.password_enc, env) : '' } : fallback()
  }
  return {
    async read() {
      const stored = await saved(), value = stored || fallback()
      return { host: value.host, port: value.port, username: value.username, from: value.from, password_configured: !!(stored ? value.password_enc : value.password), encryption_ready: /^[a-f0-9]{64}$/i.test(env.MAIL_ENCRYPTION_KEY || ''), source: stored ? 'database' : 'environment' }
    },
    async save(input) {
      const fields = validate(input)
      // Serialize read/replace in SQL, so a blank password cannot overwrite a concurrent replacement.
      const previous = await saved()
      let replacement = null
      if (input.password) replacement = encrypt(input.password, env)
      else if (!input.clearPassword && !previous && env.SMTP_PASSWORD) replacement = encrypt(env.SMTP_PASSWORD, env)
      await q(`INSERT INTO settings(key,value) VALUES('mail_config',$1::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=$1::jsonb || jsonb_build_object('password_enc',
          CASE WHEN $2::boolean THEN 'null'::jsonb WHEN $3::boolean THEN $1::jsonb->'password_enc' ELSE settings.value->'password_enc' END)`,
      [JSON.stringify({ ...fields, password_enc: replacement }), !!input.clearPassword, !!input.password])
      return this.read()
    },
    async assertConfigured() { smtpOptions(asEnv(await privateConfig())) },
    async sendVerification(message) { return createVerificationMailer(asEnv(await privateConfig()), transportFactory)(message) },
    async test() {
      if (testing) throw Object.assign(Error('Prueba en curso / Test already running'), { status: 429, retryAfter: 15 })
      testing = true
      try { await verifySmtp(asEnv(await privateConfig()), transportFactory) }
      catch { error(502, 'No se pudo verificar SMTP. Revisa la configuración guardada / SMTP verification failed. Check saved settings') }
      finally { testing = false }
    },
  }
}
