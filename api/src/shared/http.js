export const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
export const error = (status, message) => { throw Object.assign(new Error(message), { status }) }
export const requiredText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) error(400, `${label} obligatorio`)
  return value.trim()
}

export function errorHandler(err, _req, res, _next) {
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese nombre o identificador' })
  if (err.code === '22P02') return res.status(400).json({ error: 'Identificador inválido' })
  const status = err.status || (err.name === 'JsonWebTokenError' ? 401 : 500)
  if (status === 500) console.error(err)
  res.status(status).json({ error: status === 500 ? 'Error interno' : err.message })
}

export const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store').set('Pragma', 'no-cache').set('Referrer-Policy', 'no-referrer').vary('Cookie')
  next()
}
