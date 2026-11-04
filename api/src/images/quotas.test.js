import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultImageStorage,validateImageStorage } from './quotas.js'
test('image storage limits require bounded integers, permit closed budgets and reject unknown fields',()=>{
  assert.deepEqual(validateImageStorage({...defaultImageStorage,expectedVersion:1}),defaultImageStorage)
  assert.equal(validateImageStorage({...defaultImageStorage,userFiles:0}).userFiles,0)
  for(const value of [-1,1.5,'10',null,Number.MAX_SAFE_INTEGER])assert.throws(()=>validateImageStorage({...defaultImageStorage,userBytes:value}),{status:400})
  for(const input of [null,{}, {...defaultImageStorage,userId:'foreign'}, {...defaultImageStorage,unlimited:true}])assert.throws(()=>validateImageStorage(input),{status:400})
})
