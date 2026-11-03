export function createImageRepository(query) {
  return {
    async content(id) { return (await query('SELECT mime,data FROM images WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0] },
    async list() {
      return (await query('SELECT i.id,i.name,i.mime,i.created_at,u.email AS creator FROM images i LEFT JOIN users u ON u.id=i.created_by WHERE i.deleted_at IS NULL ORDER BY i.created_at DESC')).rows
    },
    async create(id, name, mime, bytes, authorId) {
      await query('INSERT INTO images(id,name,mime,data,created_by) VALUES($1,$2,$3,$4,$5)', [id, name, mime, bytes, authorId])
    },
    async archive(id) { return (await query('UPDATE images SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount },
  }
}
