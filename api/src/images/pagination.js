export async function initGalleryPaginationDb(q) {
  await q('CREATE INDEX IF NOT EXISTS images_page_all ON images(created_at DESC,id DESC) WHERE deleted_at IS NULL')
  await q("CREATE INDEX IF NOT EXISTS images_page_personal ON images(owner_id,created_at DESC,id DESC) WHERE deleted_at IS NULL AND scope<>'catalog'")
  await q("CREATE INDEX IF NOT EXISTS images_page_catalog ON images(created_at DESC,id DESC) WHERE deleted_at IS NULL AND scope='catalog'")
}
