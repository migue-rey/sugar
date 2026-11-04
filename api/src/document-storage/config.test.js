import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultDocumentStorage,validateDocumentStorage } from './config.js'
test('document storage configuration requires bounded integers and supports closed budgets',()=>{
  assert.deepEqual(validateDocumentStorage({...defaultDocumentStorage,expectedVersion:1}),defaultDocumentStorage)
  assert.equal(validateDocumentStorage({...defaultDocumentStorage,blockVersions:0}).blockVersions,0)
  for(const value of [-1,'1',0.5,null,Number.MAX_SAFE_INTEGER])assert.throws(()=>validateDocumentStorage({...defaultDocumentStorage,userBlocks:value}),{status:400})
  for(const input of [null,{}, {...defaultDocumentStorage,owner:'foreign'}])assert.throws(()=>validateDocumentStorage(input),{status:400})
})
