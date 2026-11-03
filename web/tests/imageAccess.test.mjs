import test from 'node:test'
import assert from 'node:assert/strict'
import { sharedImageUrl } from '../src/imageAccess.ts'
test('share images carry only the current link credential without changing canonical YAML URLs', () => {
  const url = '/api/images/11111111-1111-1111-1111-111111111111/content', token = 'a'.repeat(43)
  assert.equal(sharedImageUrl(url, token), `/api/shared/${token}/images/11111111-1111-1111-1111-111111111111/content`)
  assert.equal(sharedImageUrl(url, null), url)
  assert.equal(sharedImageUrl(url, '../invalid'), url)
  assert.equal(sharedImageUrl('https://example.org/image.png', token), 'https://example.org/image.png')
})
