import test from 'node:test'
import assert from 'node:assert/strict'
import { imageIds } from './references.js'
import { createImageService } from './service.js'
const id = '11111111-1111-1111-1111-111111111111', path = `/api/images/${id}/content`
test('only canonical image fields establish local resource grants; arbitrary text and remote URLs do not', () => {
  assert.deepEqual(imageIds(JSON.stringify({ nodes: [{ block: { image: path } }, { block: { image: path } }], notes: path }), 'project'), [id])
  assert.deepEqual(imageIds(JSON.stringify({ image: 'https://example.com' + path, notes: path }), 'block'), [])
  assert.deepEqual(imageIds(JSON.stringify({ image: path + '?share=invalid' }), 'block'), [])
})
test('attachment rejection cannot create references and all queries use the supplied transaction', async () => {
  let writes = 0
  const tx = async () => { writes++; return { rows: [] } }
  const service = createImageService({ content: async (imageId, user, execute) => { assert.equal(imageId, id); assert.equal(user.id, 'actor'); assert.equal(execute, tx); return null } })
  await assert.rejects(service.attach(JSON.stringify({ image: path }), 'block', id, { id: 'actor' }, tx), { status: 404 })
  assert.equal(writes, 0)
})
