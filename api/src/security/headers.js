import { error, noStore } from '../shared/http.js'

export function publicOrigin(value = '') {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || ![url.origin, url.origin + '/'].includes(value)) throw Error()
    return url.origin
  } catch { throw Object.assign(new Error('Invalid PUBLIC_ORIGIN'), { code: 'SECRET_CONFIG' }) }
}

export function apiHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  })
  noStore(req, res, next)
}

// No CORS is enabled. JSON mutations cannot be submitted by cross-origin HTML forms.
// Origin and Fetch Metadata additionally protect bodyless operations and sibling sites.
export function requestOrigin(expectedOrigin) {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const site = req.get('Sec-Fetch-Site')
    if (site && !['same-origin', 'none'].includes(site)) error(403, 'Origen de solicitud no permitido / Request origin not allowed')
    const origin = req.get('Origin')
    const target = expectedOrigin || `${req.protocol}://${req.get('host')}`
    if (origin) {
      if (origin === 'null' || origin !== target) error(403, 'Origen de solicitud no permitido / Request origin not allowed')
    } else if (req.get('Referer')) {
      let referringOrigin
      try { referringOrigin = new URL(req.get('Referer')).origin } catch { /* malformed is denied */ }
      if (referringOrigin !== target) error(403, 'Origen de solicitud no permitido / Request origin not allowed')
    }
    const type = req.get('Content-Type')
    if ((type && !/^application\/json(?:\s*;|$)/i.test(type)) || (!type && (Number(req.get('Content-Length')) > 0 || req.get('Transfer-Encoding')))) {
      error(415, 'Se requiere application/json / application/json required')
    }
    next()
  }
}
