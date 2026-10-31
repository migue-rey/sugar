import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCategoryIcon, blockImage, categorySymbols, iconNames } from '../src/categoryIcons.ts'

test('all sixteen category symbols have Spanish and English names',()=>{
  assert.equal(Object.keys(categorySymbols).length,16)
  for(const key of Object.keys(categorySymbols)) for(const lang of ['es','en']) assert.ok(iconNames[lang][key])
})
test('subcategory overrides parent and null inherits; unknown slugs fall back to generic',()=>{
  const block={category:'power',subcategory:'sources'}
  assert.equal(resolveCategoryIcon(block,{power:'power',sources:'battery'}),'battery')
  assert.equal(resolveCategoryIcon(block,{power:'power',sources:null}),'power')
  assert.equal(resolveCategoryIcon(block,{power:'power'}),'power')
  assert.equal(resolveCategoryIcon(block,{}),'cube')
  assert.equal(resolveCategoryIcon({},{}),'cube')
})
test('changing category metadata updates existing snapshots without modifying their data',()=>{
  const block={category:'power',subcategory:'sources'}, original=JSON.stringify(block)
  const icons={power:'power',sources:null}
  assert.equal(resolveCategoryIcon(block,icons),'power')
  icons.power='battery'
  assert.equal(resolveCategoryIcon(block,icons),'battery')
  assert.equal(JSON.stringify(block),original)
})
test('block images have priority and unsafe or embedded images fall back to category symbols',()=>{
  assert.equal(blockImage({image:'https://example.com/sensor.png'}),'https://example.com/sensor.png')
  const gallery='/api/images/00000000-0000-0000-0000-000000000001/content'
  assert.equal(blockImage({image:gallery}),gallery)
  for(const image of [undefined,'','javascript:alert(1)','data:image/png;base64,x','http://example.com/sensor.png']) assert.equal(blockImage({image}),'')
})
