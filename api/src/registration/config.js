import { publicOrigin } from '../security/headers.js'
import { configError } from '../config/secrets.js'

export function registrationConfig(env = process.env) {
  return emailFeatureConfig(env, 'REGISTRATION_ENABLED')
}
export function emailFeatureConfig(env, flag) {
  if (![undefined, '', 'false', 'true'].includes(env[flag])) throw configError(flag)
  const enabled = env[flag] === 'true'
  if (!enabled) return { enabled: false }
  const origin = publicOrigin(env.PUBLIC_ORIGIN)
  if (!origin || !(origin.startsWith('https://') || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname))) throw configError('PUBLIC_ORIGIN')
  return { enabled, origin }
}
