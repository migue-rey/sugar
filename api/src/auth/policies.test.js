import test from 'node:test'
import assert from 'node:assert/strict'
import { requireProjectAccess, requireAdmin, requireEdit } from './policies.js'
import { repositorySettings } from '../projects/validation.js'

const owner = { id: 'owner', role: 'dev' }, other = { id: 'other', role: 'dev' }, view = { id: 'other', role: 'view' }, admin = { id: 'admin', role: 'Admin' }
const privateProject = { created_by: owner.id, visibility: 'private' }
const publicProject = { ...privateProject, visibility: 'public' }
const denied = (fn, message, status = 403) => assert.throws(fn, e => e.status === status && e.message === message)

test('project policies preserve private/public, ownership and role permissions without Express', () => {
  for (const user of [owner, admin]) assert.equal(requireProjectAccess(privateProject, user, { edit: true }), privateProject)
  for (const user of [other, view]) denied(() => requireProjectAccess(privateProject, user), 'Proyecto privado')
  for (const user of [owner, other, view, admin]) assert.equal(requireProjectAccess(publicProject, user), publicProject)
  denied(() => requireProjectAccess(publicProject, other, { edit: true }), 'No tienes permiso para editar este proyecto')
  for (const visibility of ['public', 'private']) {
    const editorProject = { ...privateProject, visibility, member_role: 'editor' }
    assert.equal(requireProjectAccess(editorProject, other, { edit: true }), editorProject)
    const readerProject = { ...editorProject, member_role: 'reader' }
    assert.equal(requireProjectAccess(readerProject, other), readerProject)
    denied(() => requireProjectAccess(readerProject, other, { edit: true }), 'No tienes permiso para editar este proyecto')
    denied(() => requireProjectAccess(editorProject, other, { ownerOnly: true }), 'Solo el creador o un administrador puede configurar este proyecto')
    denied(() => requireProjectAccess(editorProject, view, { edit: true }), 'Se requiere rol dev o Admin')
  }
  denied(() => requireProjectAccess(publicProject, view, { edit: true }), 'Se requiere rol dev o Admin')
  denied(() => requireProjectAccess(publicProject, other, { ownerOnly: true }), 'Solo el creador o un administrador puede configurar este proyecto')
  denied(() => requireProjectAccess(null, admin), 'Proyecto no encontrado', 404)
  // Existing owners downgraded to view can still read/configure; edit requires dev/Admin.
  const viewOwner = { ...owner, role: 'view' }
  assert.equal(requireProjectAccess(privateProject, viewOwner, { ownerOnly: true }), privateProject)
  denied(() => requireProjectAccess(privateProject, viewOwner, { edit: true }), 'Se requiere rol dev o Admin')
  denied(() => requireAdmin(owner), 'Se requiere rol Admin')
  denied(() => requireEdit(view), 'Se requiere rol dev o Admin')
})

test('repository destinations retain normalization and reject invalid branches', () => {
  assert.deepEqual(repositorySettings({}), { repository: null, branch: 'main' })
  assert.deepEqual(repositorySettings({ sync_repository: ' owner/repo ', sync_branch: ' dev/board ' }), { repository: 'owner/repo', branch: 'dev/board' })
  for (const repo of ['https://github.com/owner/repo', 'owner', 'owner/repo/extra']) assert.throws(() => repositorySettings({ sync_repository: repo }), { status: 400 })
  for (const branch of ['/main', 'main/', 'a..b', 'bad branch']) assert.throws(() => repositorySettings({ sync_branch: branch }), { status: 400 })
})
