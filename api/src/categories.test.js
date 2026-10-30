import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveCategory, nameKey, slugBase, validateCategory } from './categories.js'

const root = { id: 'root', slug: 'sensores', parent_id: null, deleted_at: null }
const child = { id: 'child', slug: 'temperatura', parent_id: 'root', deleted_at: null }
const queryWith = rows => async () => ({ rows, rowCount: rows.length })

test('category identifiers remain readable and accent insensitive', () => {
  assert.equal(nameKey('  Alimentación '), 'alimentacion')
  assert.equal(slugBase('Sensores de Temperatura'), 'sensores-de-temperatura')
})
test('validates one active root and a child belonging to it', async () => {
  await validateCategory({ category: 'sensores', subcategory: 'temperatura' }, queryWith([root, child]))
  await assert.rejects(validateCategory({}, queryWith([root, child])), /Selecciona una categoría/)
  await assert.rejects(validateCategory({ category: 'sensores', subcategory: 'temperatura' }, queryWith([root, { ...child, parent_id: 'other' }])), /subcategoría no pertenece/)
  await assert.rejects(validateCategory({ category: 'sensores' }, queryWith([{ ...root, deleted_at: new Date() }])), /no está activa/)
})
test('prevents archiving categories that still contain active blocks', async () => {
  const query = async sql => {
    if (sql.startsWith('SELECT id,slug')) return { rows: [root], rowCount: 1 }
    if (sql.startsWith('SELECT 1 FROM block_categories')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT 1 FROM blocks')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
    throw Error('Unexpected query')
  }
  await assert.rejects(archiveCategory(root.id, query), /Reasigna primero/)
})
