import { categoryIcon } from './category-icons.js'
import { parseYaml } from './model.js'
import crypto from 'node:crypto'
import { q } from './db.js'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export const nameKey = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
export const slugBase = value => nameKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'categoria'

export async function listCategories(query = q) {
  return (await query('SELECT id,slug,name,parent_id,icon,deleted_at FROM block_categories ORDER BY parent_id NULLS FIRST,name')).rows
}

export async function validateCategory(block, query = q, allowUncategorized = false) {
  if (!block.category) {
    if (allowUncategorized) return
    fail(400, 'Selecciona una categoría para el bloque')
  }
  const { rows } = await query('SELECT id,slug,parent_id,deleted_at FROM block_categories WHERE slug=$1 OR slug=$2 FOR SHARE', [block.category, block.subcategory || block.category])
  const root = rows.find(row => row.slug === block.category)
  if (!root || root.parent_id || root.deleted_at) fail(400, 'La categoría no existe o no está activa')
  if (block.subcategory) {
    const child = rows.find(row => row.slug === block.subcategory)
    if (!child || child.parent_id !== root.id || child.deleted_at) fail(400, 'La subcategoría no pertenece a la categoría o no está activa')
  }
}

export async function createCategory(name, parentId, query = q, requestedIcon) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) fail(400, 'El nombre debe tener entre 1 y 80 caracteres')
  if (parentId) {
    const { rows } = await query('SELECT id,parent_id,deleted_at FROM block_categories WHERE id=$1 FOR SHARE', [parentId])
    if (!rows[0] || rows[0].parent_id || rows[0].deleted_at) fail(400, 'Selecciona una categoría principal activa')
  }
  const icon = categoryIcon(requestedIcon, parentId)
  const key = nameKey(name)
  const duplicate = await query('SELECT id FROM block_categories WHERE parent_id IS NOT DISTINCT FROM $1 AND name_key=$2 AND deleted_at IS NULL', [parentId || null, key])
  if (duplicate.rowCount) fail(409, 'Ya existe una categoría con ese nombre en este nivel')
  const base = slugBase(name)
  let slug = base, suffix = 2
  while ((await query('SELECT 1 FROM block_categories WHERE slug=$1', [slug])).rowCount) slug = `${base}-${suffix++}`
  const { rows } = await query('INSERT INTO block_categories(id,slug,name,name_key,parent_id,icon) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,slug,name,parent_id,icon,deleted_at', [crypto.randomUUID(), slug, name.trim(), key, parentId || null, icon])
  return rows[0]
}

export async function renameCategory(id, name, query = q, requestedIcon) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) fail(400, 'El nombre debe tener entre 1 y 80 caracteres')
  const current = await query('SELECT id,parent_id,icon,deleted_at FROM block_categories WHERE id=$1 FOR UPDATE', [id])
  if (!current.rows[0] || current.rows[0].deleted_at) fail(404, 'Categoría no encontrada')
  const icon = categoryIcon(requestedIcon, current.rows[0].parent_id, current.rows[0].icon)
  const key = nameKey(name)
  const duplicate = await query('SELECT id FROM block_categories WHERE id<>$1 AND parent_id IS NOT DISTINCT FROM $2 AND name_key=$3 AND deleted_at IS NULL', [id, current.rows[0].parent_id, key])
  if (duplicate.rowCount) fail(409, 'Ya existe una categoría con ese nombre en este nivel')
  const { rows } = await query('UPDATE block_categories SET name=$2,name_key=$3,icon=$4 WHERE id=$1 RETURNING id,slug,name,parent_id,icon,deleted_at', [id, name.trim(), key, icon])
  return rows[0]
}

export async function archiveCategory(id, query = q) {
  const current = await query('SELECT id,slug,parent_id,deleted_at FROM block_categories WHERE id=$1 FOR UPDATE', [id])
  const item = current.rows[0]
  if (!item || item.deleted_at) fail(404, 'Categoría no encontrada')
  if ((await query('SELECT 1 FROM block_categories WHERE parent_id=$1 AND deleted_at IS NULL LIMIT 1', [id])).rowCount) fail(409, 'Elimina primero las subcategorías')
  const column = item.parent_id ? 'subcategory_slug' : 'category_slug'
  if ((await query(`SELECT 1 FROM blocks WHERE ${column}=$1 AND deleted_at IS NULL LIMIT 1`, [item.slug])).rowCount) fail(409, 'Reasigna primero los bloques de esta categoría')
  await query('UPDATE block_categories SET deleted_at=now() WHERE id=$1', [id])
}

// Public/shared diagrams disclose only icon IDs for slugs already present in their YAML.
export async function projectCategoryIcons(yaml, query = q) {
  const project = parseYaml(yaml)
  const slugs = [...new Set((project.nodes || []).flatMap(n => [n.block?.category, n.block?.subcategory]).filter(Boolean))]
  if (!slugs.length) return {}
  const { rows } = await query('SELECT slug,icon FROM block_categories WHERE slug=ANY($1::text[])', [slugs])
  return Object.fromEntries(rows.map(row => [row.slug, row.icon]))
}
