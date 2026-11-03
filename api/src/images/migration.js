import { imageIds, recordImageReferences } from './references.js'

export async function migrateImageAccess(transaction) {
  await transaction(async tx => {
    await tx("SELECT pg_advisory_xact_lock(hashtext('sugar:image_access_v1'))")
    await tx('ALTER TABLE images ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id)')
    await tx("ALTER TABLE images ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'personal' CHECK(scope IN ('personal','catalog'))")
    await tx(`CREATE TABLE IF NOT EXISTS image_references(image_id uuid NOT NULL REFERENCES images(id),resource_kind text NOT NULL CHECK(resource_kind IN ('project','block')),resource_id uuid NOT NULL,current boolean NOT NULL DEFAULT false,PRIMARY KEY(image_id,resource_kind,resource_id))`)
    await tx('CREATE INDEX IF NOT EXISTS image_references_resource ON image_references(resource_kind,resource_id)')
    await tx('CREATE INDEX IF NOT EXISTS images_owner ON images(owner_id)')
    await tx('ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_expires_at timestamptz')
    // A marker prevents a restart from reassigning intentionally shared uploads.
    if ((await tx("SELECT 1 FROM settings WHERE key='image_access_v1'")).rowCount) return
    await tx('UPDATE images SET owner_id=created_by')
    await tx("UPDATE projects SET share_expires_at=now()+interval '7 days' WHERE share_token IS NOT NULL AND share_expires_at IS NULL")
    for (const kind of ['project', 'block']) {
      const sql = kind === 'project'
        ? 'SELECT r.project_id AS id,r.yaml,(r.revision=p.revision) AS current FROM project_revisions r JOIN projects p ON p.id=r.project_id ORDER BY r.revision'
        : 'SELECT v.block_id AS id,v.yaml,(v.version=b.latest_version) AS current FROM block_versions v JOIN blocks b ON b.id=v.block_id ORDER BY v.version'
      for (const row of (await tx(sql)).rows) await recordImageReferences(tx, kind, row.id, imageIds(row.yaml, kind), row.current)
    }
    await tx("INSERT INTO settings(key,value) VALUES('image_access_v1','true'::jsonb)")
  })
}
