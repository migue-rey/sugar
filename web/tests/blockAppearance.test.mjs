import test from 'node:test'
import assert from 'node:assert/strict'
import { headerStyle, safeHexColor } from '../src/blockAppearance.ts'

test('header color stays optional and rejects unsafe or incomplete values', () => {
  assert.equal(headerStyle(undefined), undefined)
  assert.equal(safeHexColor('#A0b1C2'), '#A0b1C2')
  for (const value of ['red', '#ABC', 'url(evil)', '#12345G']) assert.equal(headerStyle(value), undefined)
})

test('header text uses legible contrast on light and dark colors', () => {
  assert.deepEqual(headerStyle('#FFFFFF'), { backgroundColor: '#FFFFFF', color: '#000000' })
  assert.deepEqual(headerStyle('#000000'), { backgroundColor: '#000000', color: '#FFFFFF' })
  assert.equal(headerStyle('#FF0000').color, '#000000')
})
