import { error } from '../shared/http.js'
export const defaultImageStorage = Object.freeze({ userFiles: 1000, userBytes: 100_000_000, platformFiles: 10_000, platformBytes: 1_000_000_000 })
const maxima = { userFiles: 1_000_000, userBytes: 1_000_000_000_000, platformFiles: 10_000_000, platformBytes: 10_000_000_000_000 }
export function validateImageStorage(input) {
  if (!input || Object.keys(input).some(key => ![...Object.keys(defaultImageStorage), 'expectedVersion'].includes(key))) error(400, 'Cuota de imágenes inválida / Invalid image quota')
  return Object.fromEntries(Object.keys(defaultImageStorage).map(key => {
    const value = input[key]
    if (!Number.isSafeInteger(value) || value < 0 || value > maxima[key]) error(400, 'Cuota de imágenes inválida / Invalid image quota')
    return [key, value]
  }))
}
export async function initImageStorage(q) {
  await q('CREATE TABLE IF NOT EXISTS image_storage_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),value jsonb NOT NULL,version integer NOT NULL DEFAULT 1)')
  await q('INSERT INTO image_storage_config(id,value) VALUES(true,$1::jsonb) ON CONFLICT(id) DO NOTHING', [JSON.stringify(defaultImageStorage)])
  await q('CREATE INDEX IF NOT EXISTS images_storage_owner ON images(owner_id) WHERE scope<>\'catalog\'')
}
export function createImageStorage({ q, transaction }) {
  const lock = tx => tx("SELECT pg_advisory_xact_lock(hashtext('sugar:image-storage'))")
  const config = async (tx = q) => {
    const row = (await tx('SELECT value,version FROM image_storage_config WHERE id=true')).rows[0]
    if (!row) error(503, 'Migra la configuración de almacenamiento / Migrate storage configuration')
    return { ...row.value, version: row.version }
  }
  const usage = async (userId, tx = q) => {
    const row = (await tx(`SELECT count(*) AS files,COALESCE(sum(octet_length(data)),0) AS bytes,
      count(*) FILTER(WHERE owner_id=$1 AND scope<>'catalog') AS user_files,
      COALESCE(sum(octet_length(data)) FILTER(WHERE owner_id=$1 AND scope<>'catalog'),0) AS user_bytes FROM images`, [userId])).rows[0]
    return { platform: { files: row.files, bytes: row.bytes }, user: { files: row.user_files, bytes: row.user_bytes } }
  }
  const configuration = async () => { const [limits, used] = await Promise.all([config(), usage(null)]); return { ...limits, usage: used.platform } }
  async function admit(tx, ownerId, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 1) error(400, 'Tamaño de imagen inválido / Invalid image size')
    await lock(tx)
    const limits = await config(tx), used = await usage(ownerId, tx)
    if (BigInt(used.platform.files) + 1n > BigInt(limits.platformFiles) || BigInt(used.platform.bytes) + BigInt(bytes) > BigInt(limits.platformBytes)) error(409, 'Almacenamiento de imágenes de la plataforma lleno; contacta al administrador / Platform image storage is full; contact the administrator')
    if (ownerId && (BigInt(used.user.files) + 1n > BigInt(limits.userFiles) || BigInt(used.user.bytes) + BigInt(bytes) > BigInt(limits.userBytes))) error(409, 'Cuota de imágenes de tu cuenta agotada; solicita más capacidad al administrador. La papelera conserva los bytes / Your image quota is exhausted; ask the administrator for more capacity. Trash retains bytes')
  }
  return {
    admit,
    async create(ownerId, bytes, write) { return transaction(async tx => { await admit(tx, ownerId, bytes); return write(tx) }) },
    async summary(userId) {
      const [limits, rows] = await Promise.all([config(), q("SELECT count(*) AS files,COALESCE(sum(octet_length(data)),0) AS bytes FROM images WHERE owner_id=$1 AND scope<>'catalog'", [userId])])
      return { limits: { userFiles: limits.userFiles, userBytes: limits.userBytes }, usage: rows.rows[0] }
    },
    configuration,
    async configure(input) {
      const limits = validateImageStorage(input)
      if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) error(400, 'Versión de cuota inválida / Invalid quota version')
      await transaction(async tx => {
        await lock(tx)
        const row = await tx('UPDATE image_storage_config SET value=$1::jsonb,version=version+1 WHERE id=true AND version=$2 RETURNING version', [JSON.stringify(limits), input.expectedVersion])
        if (!row.rowCount) error(409, 'La cuota cambió; recarga antes de guardar / Quota changed; reload before saving')
      })
      return configuration()
    },
  }
}
