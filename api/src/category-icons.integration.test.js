import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import YAML from 'yaml'
const url=process.env.ICON_TEST_URL
// Creates data only in a fresh disposable test installation. Never target the main app.
test('category icons with real authentication, database and shared project responses',{skip:!url},async t=>{
  async function request(path,{method='GET',body,cookie}={}) { const r=await fetch(url+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]} }
  const login=await request('/login',{method:'POST',body:{email:'admin@local',password:'local-icons-verification-password'}});assert.equal(login.status,200)
  const cookie=login.cookie, suffix=crypto.randomUUID().slice(0,8)
  const initial=(await request('/categories',{cookie})).body
  assert.equal(initial.find(c=>c.slug==='alimentacion').icon,'power')
  assert.equal(initial.find(c=>c.slug==='controladores').icon,'cpu')
  assert.equal(initial.find(c=>c.slug==='sensores').icon,'sensor')
  const root=await request('/categories',{method:'POST',cookie,body:{name:'Test power '+suffix,icon:'power'}});assert.equal(root.status,201)
  const child=await request('/categories',{method:'POST',cookie,body:{name:'Test sources',parentId:root.body.id,icon:null}});assert.equal(child.body.icon,null)
  const invalid=await request('/categories',{method:'POST',cookie,body:{name:'Invalid icon',icon:'not-an-icon'}});assert.equal(invalid.status,400)
  const legacy=await request('/categories',{method:'POST',cookie,body:{name:'Legacy category '+suffix}});assert.equal(legacy.body.icon,'cube')
  const preserved=await request('/categories/'+root.body.id,{method:'PATCH',cookie,body:{name:'Test energy '+suffix}});assert.equal(preserved.body.icon,'power')
  const doc={name:'Icon inheritance verification',nodes:[{id:crypto.randomUUID(),position:{x:100,y:100},block:{name:'Power block',function:'Provide power',category:root.body.slug,subcategory:child.body.slug,ports:[{id:'power',label:'Power',protocol:'POWER',direction:'out',color:'#FF0000'}]}}],edges:[]}
  const block=await request('/blocks',{method:'POST',cookie,body:{yaml:YAML.stringify(doc.nodes[0].block)}});assert.equal(block.status,201)
  const project=await request('/projects',{method:'POST',cookie,body:{yaml:YAML.stringify(doc)}});assert.equal(project.status,201)
  const change=await request('/categories/'+root.body.id,{method:'PATCH',cookie,body:{name:'Test energy '+suffix,icon:'battery'}});assert.equal(change.body.icon,'battery')
  const loaded=await request('/projects/'+project.body.id,{cookie});assert.equal(loaded.body.revision,1);assert.deepEqual(YAML.parse(loaded.body.yaml),doc)
  assert.equal((await request('/blocks/'+block.body.id+'/versions',{cookie})).body.length,1)
  await request('/projects/'+project.body.id+'/settings',{method:'PATCH',cookie,body:{visibility:'public',sync_repository:'',sync_branch:'main',expectedSettingsVersion:1}})
  const published=await request('/public/projects/'+project.body.id)
  assert.deepEqual(published.body.category_icons,{[root.body.slug]:'battery',[child.body.slug]:null})
  assert.equal(Object.keys(published.body.category_icons).length,2)
  await request('/projects/'+project.body.id+'/settings',{method:'PATCH',cookie,body:{visibility:'private',sync_repository:'',sync_branch:'main',expectedSettingsVersion:2}})
  const shared=await request('/projects/'+project.body.id+'/share',{method:'POST',cookie})
  const token=new URL('http://local'+shared.body.path).searchParams.get('share')
  assert.deepEqual((await request('/shared/'+token)).body.category_icons,published.body.category_icons)
  await request('/projects/'+project.body.id+'/settings',{method:'PATCH',cookie,body:{visibility:'public',sync_repository:'',sync_branch:'main',expectedSettingsVersion:3}})
  for(const role of ['dev','view']) {
    await request('/users',{method:'POST',cookie,body:{email:role+'_'+suffix+'@local',password:'local-user-password',role}})
    const user=await request('/login',{method:'POST',body:{email:role+'_'+suffix+'@local',password:'local-user-password'}});assert.equal(user.body.theme,'light')
    assert.equal((await request('/categories',{method:'POST',cookie:user.cookie,body:{name:'Forbidden',icon:'power'}})).status,403)
    assert.equal((await request('/categories/'+root.body.id,{method:'PATCH',cookie:user.cookie,body:{name:'Forbidden',icon:'power'}})).status,403)
  }
  const ownIcon=await request('/categories/'+child.body.id,{method:'PATCH',cookie,body:{name:'Test sources',icon:'light'}});assert.equal(ownIcon.body.icon,'light')
  assert.equal((await request('/public/projects/'+project.body.id)).body.category_icons[child.body.slug],'light')
  await request('/categories/'+child.body.id,{method:'PATCH',cookie,body:{name:'Test sources',icon:null}})
  assert.equal((await request('/public/projects/'+project.body.id)).body.category_icons[child.body.slug],null)
})
