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
test('library pages pack whole YAML items within a byte budget and reject oversized legacy arrays', {skip:!url},async t=>{
  const schema='blocks_bytes_'+crypto.randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString:url})
  await admin.query('CREATE SCHEMA '+schema)
  const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema}),q=(sql,args)=>pool.query(sql,args)
  t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
  await q('CREATE TABLE blocks(id uuid PRIMARY KEY,name text,latest_version int,owner_id uuid,deleted_at timestamptz)')
  await q('CREATE TABLE block_versions(block_id uuid,version int,yaml text,created_at timestamptz DEFAULT now(),PRIMARY KEY(block_id,version))')
  await initBlockPaginationDb(q)
  const a={id:crypto.randomUUID(),role:'dev'},b={id:crypto.randomUUID(),role:'dev'},c={id:crypto.randomUUID(),role:'dev'},id=i=>'00000000-0000-0000-0000-'+String(i).padStart(12,'0'),big='x'.repeat(1500000)
  const insert=async(i,owner,yaml)=>{await q('INSERT INTO blocks VALUES($1,$2,1,$3,NULL)',[id(i),'Fixture '+i,owner]);await q('INSERT INTO block_versions(block_id,version,yaml) VALUES($1,1,$2)',[id(i),yaml])}
  for(let i=1;i<=4;i++)await insert(i,a.id,big)
  await insert(5,null,'catalog');await insert(6,b.id,big)
  const repository=createBlockRepository(q),service=createBlockService({blocks:repository})
  const first=await service.page(a,{limit:'30'});assert.equal(first.items.length,2);assert.equal(first.nextCursor,id(2))
  assert.ok(first.items.every(i=>i.yaml===big&&i.page_more===undefined&&i.page_oversized===undefined))
  const second=await service.page(a,{limit:'30',cursor:first.nextCursor});assert.equal(second.items.length,3);assert.equal(second.nextCursor,null)
  assert.deepEqual([...first.items,...second.items].map(i=>i.id),[1,2,3,4,5].map(id))
  assert.ok([...first.items,...second.items].every(i=>i.id!==id(6)))
  await assert.rejects(service.list(a),{status:413})
  await insert(0,b.id,'x'.repeat(4*1024*1024+1))
  const guarded=await repository.page(b,{limit:30,after:null});assert.equal(guarded.length,1);assert.equal(guarded[0].page_oversized,true);assert.equal(guarded[0].yaml,null)
  await assert.rejects(service.page(b,{}),{status:413})
  assert.equal((await service.get(id(0),b)).yaml.length,4*1024*1024+1)
  const d={id:crypto.randomUUID(),role:'dev'},exact=4*1024*1024-Buffer.byteLength('Fixture 7')
  await insert(7,d.id,'x'.repeat(exact))
  const small=await service.page(d,{});assert.equal(small.items.length,1);assert.equal(small.nextCursor,id(5))
  const boundary=await service.page(d,{cursor:small.nextCursor});assert.equal(boundary.items[0].yaml.length,exact);assert.equal(boundary.nextCursor,null)
  for(let i=100;i<201;i++)await insert(i,c.id,'small')
  await assert.rejects(service.list(c),{status:413})
  const bounded=await service.page(c,{limit:'100'});assert.equal(bounded.items.length,100);assert.ok(bounded.nextCursor)
  assert.equal((await service.page(c,{limit:'100',cursor:bounded.nextCursor})).items.length,2)
  const legacy=await service.list({id:crypto.randomUUID(),role:'view'});assert.equal(legacy.length,1);assert.equal(legacy[0].yaml,'catalog')
})
