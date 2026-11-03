// Existing rows stay in the shared catalog (owner_id NULL). Do not rewrite YAML,
// slugs, authors, versions or project snapshots when introducing ownership.
export async function migrateLibraryOwnership(transaction) {
  await transaction(async tx => {
    await tx('ALTER TABLE block_categories ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id)')
    await tx('ALTER TABLE blocks ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id)')
    await tx(`CREATE UNIQUE INDEX IF NOT EXISTS block_categories_scope_name ON block_categories (coalesce(owner_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),name_key) WHERE deleted_at IS NULL`)
    await tx('DROP INDEX IF EXISTS block_categories_sibling_name')
    await tx('CREATE INDEX IF NOT EXISTS blocks_owner ON blocks(owner_id)')
  })
}
