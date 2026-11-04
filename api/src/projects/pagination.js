export async function initProjectPaginationDb(q) {
  await q('CREATE INDEX IF NOT EXISTS projects_page_all ON projects(created_at DESC,id DESC) WHERE deleted_at IS NULL')
  await q('CREATE INDEX IF NOT EXISTS projects_page_owner ON projects(created_by,created_at DESC,id DESC) WHERE deleted_at IS NULL')
  await q("CREATE INDEX IF NOT EXISTS projects_page_public ON projects(created_at DESC,id DESC) WHERE deleted_at IS NULL AND visibility='public'")
}
