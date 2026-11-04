export async function initBlockPaginationDb(q) {
  await q('CREATE INDEX IF NOT EXISTS blocks_page_all ON blocks(id) WHERE deleted_at IS NULL')
  await q('CREATE INDEX IF NOT EXISTS blocks_page_owner ON blocks(owner_id,id) WHERE deleted_at IS NULL')
  await q('CREATE INDEX IF NOT EXISTS blocks_page_catalog ON blocks(id) WHERE deleted_at IS NULL AND owner_id IS NULL')
}
