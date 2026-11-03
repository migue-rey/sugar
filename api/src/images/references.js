import { parseYaml } from '../model.js'

export function imageIds(yaml, kind) {
  const doc = parseYaml(yaml)
  const blocks = kind === 'project' ? doc.nodes?.map(n => n.block) : [doc]
  return [...new Set((blocks || []).flatMap(block => {
    const match = /^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/.exec(block?.image || '')
    return match ? [match[1]] : []
  }))]
}

// Keep historical grants for authenticated readers, but publish only current images.
export async function recordImageReferences(tx, kind, resourceId, ids, current = true) {
  if (current) await tx('UPDATE image_references SET current=false WHERE resource_kind=$1 AND resource_id=$2', [kind, resourceId])
  for (const id of ids) await tx(`INSERT INTO image_references(image_id,resource_kind,resource_id,current) SELECT id,$2,$3,$4 FROM images WHERE id=$1 ON CONFLICT(image_id,resource_kind,resource_id) DO UPDATE SET current=image_references.current OR excluded.current`, [id, kind, resourceId, current])
}
