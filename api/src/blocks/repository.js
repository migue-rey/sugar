export function createBlockRepository(query) {
  return {
    async list(user) {
      return (await query(`SELECT b.id,b.name,b.latest_version,b.owner_id,v.yaml,v.created_at FROM blocks b JOIN block_versions v ON v.block_id=b.id AND v.version=b.latest_version WHERE b.deleted_at IS NULL AND (b.owner_id IS NULL OR b.owner_id=$1 OR $2='Admin') ORDER BY b.name`, [user.id, user.role])).rows
    },
    async find(id, execute = query, lock = false) {
      return (await execute(`SELECT id,owner_id FROM blocks WHERE id=$1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    },
    async create(id, block, tx, ownerId) {
      await tx('INSERT INTO blocks(id,name,latest_version,category_slug,subcategory_slug,owner_id) VALUES($1,$2,1,$3,$4,$5)', [id, block.name, block.category, block.subcategory || null, ownerId])
    },
    async addVersion(id, version, yaml, authorId, summary, tx) {
      await tx('INSERT INTO block_versions(block_id,version,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [id, version, yaml, authorId, summary])
    },
    async versions(id) {
      return (await query('SELECT v.version,v.summary,v.created_at,u.email AS author FROM block_versions v LEFT JOIN users u ON u.id=v.author_id WHERE block_id=$1 ORDER BY version DESC', [id])).rows
    },
    async versionsPage(id, { limit, before }) {
      const args = [id], boundary = before === null ? '' : 'AND v.version<$2::integer'
      if (before !== null) args.push(before)
      args.push(limit + 1)
      return (await query(`SELECT v.version,v.summary,v.created_at,u.email AS author FROM block_versions v
        LEFT JOIN users u ON u.id=v.author_id WHERE v.block_id=$1 ${boundary}
        ORDER BY v.version DESC LIMIT $${args.length}`, args)).rows
    },
    async version(id, version) {
      return (await query('SELECT yaml FROM block_versions WHERE block_id=$1 AND version=$2', [id, version])).rows[0]
    },
    async comparison(id, from, to) {
      return (await query('SELECT version,yaml FROM block_versions WHERE block_id=$1 AND version=ANY($2::int[])', [id, [from, to]])).rows
    },
    async save(id, expected, block, tx) {
      return (await tx('UPDATE blocks SET name=$3,category_slug=$4,subcategory_slug=$5,latest_version=latest_version+1 WHERE id=$1 AND latest_version=$2 AND deleted_at IS NULL RETURNING latest_version', [id, expected, block.name, block.category || null, block.subcategory || null])).rows[0]
    },
    async archive(id, tx = query) { await tx('UPDATE blocks SET deleted_at=now() WHERE id=$1', [id]) },
  }
}
