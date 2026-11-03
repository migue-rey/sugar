import test from 'node:test'
import assert from 'node:assert/strict'
import { libraryOwner, requireLibraryAccess, libraryPermissions } from './access.js'
import { validateCategory } from '../categories.js'
const a = { id: 'a', role: 'dev' }, b = { id: 'b', role: 'dev' }, admin = { id: 'admin', role: 'Admin' }, view = { id: 'a', role: 'view' }
test('personal library is private and shared catalog is maintained only by Admin', () => {
  const personal = { owner_id: 'a' }, catalog = { owner_id: null }
  assert.equal(requireLibraryAccess(personal, a, true), personal)
  assert.equal(requireLibraryAccess(personal, admin, true), personal)
  assert.throws(() => requireLibraryAccess(personal, b), { status: 404 })
  assert.equal(requireLibraryAccess(personal, view), personal)
  assert.throws(() => requireLibraryAccess(personal, view, true), { status: 403 })
  for (const user of [a, b, view, admin]) assert.equal(requireLibraryAccess(catalog, user), catalog)
  for (const user of [a, b, view]) assert.throws(() => requireLibraryAccess(catalog, user, true), { status: 403 })
  assert.equal(requireLibraryAccess(catalog, admin, true), catalog)
  assert.deepEqual(libraryPermissions(catalog, a), { scope: 'catalog', canEdit: false })
  assert.deepEqual(libraryPermissions(personal, a), { scope: 'personal', canEdit: true })
  assert.equal(libraryOwner(a), 'a'); assert.equal(libraryOwner(admin), null)
  assert.equal(libraryOwner(admin, 'personal'), 'admin')
  assert.throws(() => libraryOwner(a, 'catalog'), { status: 403 })
  assert.throws(() => libraryOwner(a, 'unknown'), { status: 400 })
})
test('private categories are valid only for the same library owner; catalog cannot use them', async () => {
  const root = { id: 'root', slug: 'private', owner_id: 'a' }
  const q = async () => ({ rows: [root] })
  await validateCategory({ category: 'private' }, q, false, 'a')
  for (const owner of ['b', null]) await assert.rejects(validateCategory({ category: 'private' }, q, false, owner), { status: 400 })
})
