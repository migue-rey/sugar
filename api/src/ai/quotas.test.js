import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultQuotas, validateQuotas, reservedTokens, createAiQuotas } from './quotas.js'
test('quota limits require bounded integer values and permit zero budgets', () => {
  assert.deepEqual(validateQuotas(defaultQuotas),defaultQuotas)
  assert.equal(validateQuotas({...defaultQuotas,userTokens:0}).userTokens,0)
  for(const change of [{userRequests:-1},{globalTokens:Infinity},{periodHours:0},{periodHours:745},{maxConcurrent:33},{userTokens:'100'}])assert.throws(()=>validateQuotas({...defaultQuotas,...change}),{status:400})
  assert.ok(reservedTokens([{role:'user',content:'prueba'}])>4000)
})
test('a failed durable reservation cannot fall through to a provider call', async () => {
  let writes=0
  const quota=createAiQuotas({q:async()=>{throw Error('store unavailable')},transaction:async fn=>fn(async()=>{writes++;throw Error('store unavailable')})})
  await assert.rejects(quota.reserve('user','request','hash',100),/store unavailable/)
  assert.equal(writes,1)
})
