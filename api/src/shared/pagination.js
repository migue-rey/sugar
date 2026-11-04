import { error } from './http.js'
const invalid = () => error(400, 'Paginación inválida / Invalid pagination')
export function pageInput(query = {}) {
  if (Object.keys(query).some(key => !['limit','cursor'].includes(key))) invalid()
  const limit = query.limit === undefined ? 30 : typeof query.limit === 'string' && /^[1-9]\d{0,2}$/.test(query.limit) ? Number(query.limit) : 0
  if (limit < 1 || limit > 100) invalid()
  let after = null
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) invalid()
    try {
      const bytes = Buffer.from(query.cursor, 'base64url')
      if (bytes.toString('base64url') !== query.cursor) invalid()
      after = JSON.parse(bytes.toString())
      if (!after || Array.isArray(after) || Object.keys(after).sort().join(',') !== 'at,id' || typeof after.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(after.at) || Number(after.at.slice(0,4)) < 1 || new Date(after.at).toISOString().slice(0,23) !== after.at.slice(0,23) || typeof after.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(after.id)) invalid()
    } catch { invalid() }
  }
  return { limit, after }
}
export function pageResult(rows, limit, serialize) {
  const visible = rows.slice(0, limit), last = visible.at(-1)
  return {
    items: visible.map(({ cursor_time, ...row }) => serialize(row)),
    nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ at: last.cursor_time, id: last.id })).toString('base64url') : null,
  }
}
