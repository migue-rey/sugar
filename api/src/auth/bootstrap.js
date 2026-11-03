import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
export async function bootstrapAdmin({ transaction, env = process.env, log = console.info }) {
  const created = await transaction(async tx => {
    await tx("SELECT pg_advisory_xact_lock(hashtext('sugar:initial-admin'))")
    if ((await tx('SELECT count(*)::int AS n FROM users')).rows[0].n !== 0) return false
    const email = (env.ADMIN_EMAIL || 'admin@local').trim().toLowerCase(), password = env.ADMIN_PASSWORD
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) throw Object.assign(new Error('Initial administrator requires valid ADMIN_EMAIL and an explicit ADMIN_PASSWORD (12 characters minimum, 72 bytes maximum).'), { code: 'BOOTSTRAP_CONFIG' })
    await tx('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), email, await bcrypt.hash(password, 12), 'Admin'])
    return true
  })
  if (created) log('Initial administrator created. Use the configured credentials to sign in.')
  return created
}
