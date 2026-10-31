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

test('category icons support root defaults, child inheritance and reject unknown icons', async () => {
  const { categoryIcon, CATEGORY_ICONS } = await import('./category-icons.js')
  assert.equal(new Set(CATEGORY_ICONS).size,16)
  assert.equal(categoryIcon(undefined,null),'cube')
  assert.equal(categoryIcon(undefined,'parent'),null)
  assert.equal(categoryIcon(undefined,null,'power'),'power')
  assert.equal(categoryIcon('battery','parent'),'battery')
  assert.throws(()=>categoryIcon(null,null),/icono válido/)
  assert.throws(()=>categoryIcon('<svg>',null),/icono válido/)
})
test('creating a category persists its icon and a child can inherit', async () => {
  const { createCategory } = await import('./categories.js')
  const writes=[]
  const query=async(sql,args)=>{
    if(sql.includes('FOR SHARE')) return {rows:[{id:'parent',parent_id:null,deleted_at:null}]}
    if(sql.startsWith('INSERT')) { writes.push(args);return {rows:[{id:args[0],slug:args[1],name:args[2],parent_id:args[4],icon:args[5]}]} }
    return {rows:[],rowCount:0}
  }
  assert.equal((await createCategory('Power',null,query,'power')).icon,'power')
  assert.equal((await createCategory('Sources','parent',query,null)).icon,null)
  assert.equal(writes[0][5],'power')
})
test('renaming preserves a category icon; changing its icon preserves the stable slug', async () => {
  const { renameCategory } = await import('./categories.js')
  const query=async(sql,args)=>{
    if(sql.includes('FOR UPDATE')) return {rows:[{id:'root',parent_id:null,icon:'power',deleted_at:null}]}
    if(sql.startsWith('UPDATE')) return {rows:[{id:args[0],slug:'power',name:args[1],icon:args[3]}]}
    return {rows:[],rowCount:0}
  }
  assert.equal((await renameCategory('root','Energy',query)).icon,'power')
  const changed=await renameCategory('root','Energy',query,'battery')
  assert.equal(changed.icon,'battery'); assert.equal(changed.slug,'power')
  await assert.rejects(renameCategory('root','Energy',query,null),/icono válido/)
})
test('public icon metadata queries only the category slugs used by the project', async () => {
  const { projectCategoryIcons }=await import('./categories.js')
  const map=await projectCategoryIcons('nodes:\n  - block:\n      category: power\n      subcategory: sources\n',async(sql,args)=>{
    assert.deepEqual(args,[['power','sources']]);assert.match(sql,/WHERE slug=ANY/)
    return {rows:[{slug:'power',icon:'power'},{slug:'sources',icon:null}]}
  })
  assert.deepEqual(map,{power:'power',sources:null})
  assert.deepEqual(await projectCategoryIcons('nodes: []',()=>{throw new Error('should not query')}),{})
})
