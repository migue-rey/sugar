import test from 'node:test'
import assert from 'node:assert/strict'
import { documentLimits as limits,revisionSummary,stringify,validateBlock,validateProject } from './model.js'
import { createBlockService } from './blocks/service.js'
import { createProjectService } from './projects/service.js'
import { repositorySettings } from './projects/validation.js'
const block=()=>({name:'Fixture',function:'Measure',ports:[{id:'p',label:'P',protocol:'IO',direction:'in'}]})
test('metadata boundaries use UTF-8 bytes without truncating names, labels, descriptions or summaries',()=>{
  let value={...block(),name:'é'.repeat(limits.nameBytes/2)}
  assert.equal(validateBlock(stringify(value)).name,value.name)
  value.name+='é';assert.throws(()=>validateBlock(stringify(value)),/maximum 800/)
  for(const [key,max] of [['function',limits.descriptionBytes],['model',limits.nameBytes]]){
    value={...block(),[key]:'x'.repeat(max)};assert.equal(validateBlock(stringify(value))[key].length,max)
    value[key]+='x';assert.throws(()=>validateBlock(stringify(value)),{status:400})
  }
  for(const [key,max] of [['id',limits.identifierBytes],['label',limits.nameBytes],['protocol',limits.protocolBytes]]){
    value=block();value.ports[0][key]='x'.repeat(max);assert.equal(validateBlock(stringify(value)).ports[0][key].length,max)
    value.ports[0][key]+='x';assert.throws(()=>validateBlock(stringify(value)),{status:400})
  }
  const summary='é'.repeat(limits.summaryBytes/2);assert.equal(revisionSummary(summary,'default'),summary)
  assert.throws(()=>revisionSummary(summary+'é','default'),{status:400})
  for(const value of [false,1,{},[]])assert.throws(()=>revisionSummary(value,'default'),{status:400})
  assert.equal(revisionSummary('   ','default'),'default')
  assert.equal(revisionSummary(' review ','default'),'review')
})
test('property/link counts and diagram identifiers fail before large metadata can be stored',()=>{
  let value={...block(),properties:Object.fromEntries(Array.from({length:limits.propertyKeys},(_,i)=>['key'+i,'value']))}
  assert.equal(Object.keys(validateBlock(stringify(value)).properties).length,limits.propertyKeys)
  value.properties.extra='x';assert.throws(()=>validateBlock(stringify(value)),/Properties per block/)
  assert.throws(()=>validateBlock(stringify({...block(),properties:{['x'.repeat(limits.propertyKeyBytes+1)]:'x'}})),/Property name/)
  value={...block(),properties:{urls:Array.from({length:limits.links},(_,i)=>({['url'+i]:'https://example.invalid/datasheet'}))}}
  assert.equal(validateBlock(stringify(value)).properties.urls.length,limits.links)
  value.properties.urls.push({extra:'https://example.invalid'});assert.throws(()=>validateBlock(stringify(value)),/Links per block/)
  assert.throws(()=>validateProject(stringify({name:'x'.repeat(limits.nameBytes+1),nodes:[],edges:[]})),{status:400})
  assert.throws(()=>validateProject(stringify({name:'Fixture',nodes:[{id:'x'.repeat(limits.identifierBytes+1),position:{x:0,y:0},block:block()}],edges:[]})),/Identifier/)
  assert.throws(()=>repositorySettings({sync_repository:'a/'+ 'x'.repeat(199)}),{status:400})
  assert.throws(()=>repositorySettings({sync_repository:'fixture/repo',sync_branch:'x'.repeat(257)}),{status:400})
  assert.equal(repositorySettings({sync_repository:'fixture/repo',sync_branch:'x'.repeat(256)}).branch.length,256)
})
test('invalid revision summaries reject creation before transactions or image attachment',async()=>{
  const fail=()=>{throw Error('Unexpected write')},user={id:'fixture',role:'dev'},summary='x'.repeat(limits.summaryBytes+1)
  const projects=createProjectService({projects:{},transaction:fail,attachImages:fail}),blocks=createBlockService({blocks:{},transaction:fail,validateCategory:fail,attachImages:fail})
  await assert.rejects(projects.create(user,{yaml:stringify({name:'Fixture',nodes:[],edges:[]}),summary}),{status:400})
  await assert.rejects(blocks.create(user,{yaml:stringify(block()),summary}),{status:400})
  const projectSave=createProjectService({projects:{find:async()=>({created_by:user.id,visibility:'private'})},storage:{write:fail}})
  await assert.rejects(projectSave.save('project',user,{yaml:stringify({name:'Fixture',nodes:[],edges:[]}),expectedRevision:1,summary}),{status:400})
  const blockSave=createBlockService({blocks:{find:async()=>({owner_id:user.id})},storage:{write:fail}})
  await assert.rejects(blockSave.save('block',user,{yaml:stringify(block()),expectedVersion:1,summary}),{status:400})
})
