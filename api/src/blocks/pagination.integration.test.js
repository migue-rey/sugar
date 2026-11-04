import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { createBlockRepository } from './repository.js'
import { createBlockService } from './service.js'
import { initBlockPaginationDb } from './pagination.js'
const url=process.env.API_TEST_DATABASE_URL
test('library pages bound current YAML reads and preserve owner/catalog/Admin access across changes', {skip:!url}, async t=>{
  const schema='blocks_page_'+crypto.randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString:url})
  await admin.query('CREATE SCHEMA '+schema)
  const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema}),q=(sql,args)=>pool.query(sql,args)
  t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
  await q('CREATE TABLE blocks(id uuid PRIMARY KEY,name text,latest_version int,owner_id uuid,deleted_at timestamptz)')
  await q('CREATE TABLE block_versions(block_id uuid,version int,yaml text,created_at timestamptz DEFAULT now(),PRIMARY KEY(block_id,version))')
  await initBlockPaginationDb(q);await initBlockPaginationDb(q)
  const a={id:crypto.randomUUID(),role:'dev'},b={id:crypto.randomUUID(),role:'view'},ids=[]
  // Legacy/incomplete rows without a current version must not consume a candidate slot.
  await q("INSERT INTO blocks VALUES('00000000-0000-0000-0000-000000000000','Incomplete legacy block',0,$1,NULL)",[a.id])
  for(let i=1;i<=67;i++){
    const id='00000000-0000-0000-0000-'+String(i).padStart(12,'0');ids.push(id)
    await q('INSERT INTO blocks VALUES($1,$2,2,$3,$4)',[id,'Fixture '+i,i%3===0?null:i%3===1?a.id:b.id,i===67?new Date():null])
    await q("INSERT INTO block_versions VALUES($1,1,'old YAML',now()),($1,2,$2,now())",[id,'current YAML '+i])
  }
  const service=createBlockService({blocks:createBlockRepository(q)}),seen=[];let cursor
  do{
    const page=await service.page(a,{limit:'7',...(cursor?{cursor}:{})});assert.ok(page.items.length<=7)
    for(const item of page.items){seen.push(item.id);assert.equal(item.latest_version,2);assert.ok(item.yaml.startsWith('current YAML'));assert.equal(item.permissions.canEdit,item.owner_id===a.id)}
    cursor=page.nextCursor
  }while(cursor)
  const allowed=ids.filter((_,i)=>(i+1)%3!==2&&i!==66);assert.deepEqual(seen,allowed);assert.equal(new Set(seen).size,seen.length)
  assert.equal((await service.page({...a,role:'Admin'},{limit:'100'})).items.length,66)
  const foreign=(await service.page({...b,role:'Admin'},{limit:'1'})).nextCursor
  assert.ok((await service.page(a,{cursor:foreign})).items.every(item=>allowed.includes(item.id)))
  assert.equal((await service.get(ids[2],b)).permissions.canEdit,false)
  assert.equal((await service.get(ids[1],b)).permissions.canEdit,false)
  await assert.rejects(service.get(ids[1],a),{status:404})
  await assert.rejects(service.get(ids[66],{...a,role:'Admin'}),{status:404})
  const first=await service.page(a,{limit:'1'})
  await q('UPDATE blocks SET name=$2,latest_version=3 WHERE id=$1',[ids[2],'Renamed block'])
  await q("INSERT INTO block_versions VALUES($1,3,'updated current YAML',now())",[ids[2]])
  assert.equal((await service.page(a,{limit:'1',cursor:first.nextCursor})).items[0].yaml,'updated current YAML')
  await q('UPDATE blocks SET owner_id=$2 WHERE id=$1',[ids[2],b.id])
  assert.ok((await service.page(a,{cursor:first.nextCursor})).items.every(item=>item.id!==ids[2]))
  await q('UPDATE blocks SET deleted_at=now() WHERE id=$1',[ids[0]])
  await assert.rejects(service.get(ids[0],a),{status:404})
  assert.ok((await service.page(a,{})).items.every(item=>item.id!==ids[0]))
})
