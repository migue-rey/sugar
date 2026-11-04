import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { createTransaction } from '../db.js'
import { defaultDocumentStorage } from './config.js'
import { initDocumentStorage } from './migration.js'
import { createDocumentStorage } from './service.js'
import { createDocumentStorageRepository } from './repository.js'
import { createProjectRepository } from '../projects/repository.js'
import { createProjectService } from '../projects/service.js'
import { createBlockRepository } from '../blocks/repository.js'
import { createBlockService } from '../blocks/service.js'
import { initImageStorage,createImageStorage } from '../images/quotas.js'
import { replaceEmbeddedImages } from '../images.js'
import { stringify } from '../model.js'
const url=process.env.API_TEST_DATABASE_URL
const block={name:'Fixture ñ',function:'Measure',category:'fixture',ports:[{id:'p',label:'P',protocol:'IO',direction:'in'}]},blockYaml=stringify(block),projectYaml=stringify({name:'Fixture',nodes:[],edges:[]})
test('document quotas coordinate content writes, charge owners, retain history and roll back dependent writes', {skip:!url},async t=>{
  const schema='document_storage_'+crypto.randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString:url})
  await admin.query('CREATE SCHEMA '+schema)
  const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema}),q=(sql,args)=>pool.query(sql,args),transaction=createTransaction(pool)
  t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()})
  await q('CREATE TABLE users(id uuid PRIMARY KEY,email text)')
  await q("CREATE TABLE projects(id uuid PRIMARY KEY,name text,revision int,yaml text,created_by uuid,visibility text DEFAULT 'private',deleted_at timestamptz,created_at timestamptz DEFAULT now(),sync_repository text,sync_branch text DEFAULT 'main',settings_version int DEFAULT 1)")
  await q('CREATE TABLE project_revisions(project_id uuid,revision int,yaml text,summary text,author_id uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(project_id,revision))')
  await q('CREATE TABLE project_members(project_id uuid,user_id uuid,role text,PRIMARY KEY(project_id,user_id))')
  await q('CREATE TABLE blocks(id uuid PRIMARY KEY,name text,latest_version int,category_slug text,subcategory_slug text,owner_id uuid,deleted_at timestamptz)')
  await q('CREATE TABLE block_versions(block_id uuid,version int,yaml text,summary text,author_id uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(block_id,version))')
  await q('CREATE TABLE sync_jobs(id uuid PRIMARY KEY,record_id uuid,revision int,yaml text)')
  await q('CREATE TABLE images(id uuid PRIMARY KEY,name text,mime text,data bytea NOT NULL,owner_id uuid,scope text)')
  await initDocumentStorage(q);await initImageStorage(q)
  const storage=createDocumentStorage({repository:createDocumentStorageRepository(q),transaction}),otherStorage=createDocumentStorage({repository:createDocumentStorageRepository(q),transaction}),imageStorage=createImageStorage({q,transaction})
  const a={id:crypto.randomUUID(),role:'dev'},b={id:crypto.randomUUID(),role:'dev'},root={id:crypto.randomUUID(),role:'Admin'}
  const enqueue=async(_kind,id,revision,yaml,tx)=>tx('INSERT INTO sync_jobs VALUES($1,$2,$3,$4)',[crypto.randomUUID(),id,revision,yaml])
  const projects=createProjectService({projects:createProjectRepository(q),storage,transaction,enqueue,replaceEmbeddedImages}),otherProjects=createProjectService({projects:createProjectRepository(q),storage:otherStorage,transaction,enqueue,replaceEmbeddedImages})
  const blocks=createBlockService({blocks:createBlockRepository(q),storage,transaction,validateCategory:async()=>{},replaceEmbeddedImages:(yaml,kind,tx,options)=>replaceEmbeddedImages(yaml,kind,tx,{...options,storage:imageStorage})})
  const configure=async patch=>storage.configure({...defaultDocumentStorage,...patch,expectedVersion:(await storage.configuration()).version})
  await configure({userProjects:1,projectRevisions:2})
  let concurrent=await Promise.allSettled([projects.create(a,{yaml:projectYaml}),otherProjects.create(a,{yaml:projectYaml})])
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1)
  const p=concurrent.find(r=>r.status==='fulfilled').value.id
  await projects.create(b,{yaml:projectYaml})
  await projects.save(p,a,{yaml:projectYaml,expectedRevision:1,summary:'Saved'})
  await q("UPDATE projects SET sync_repository='fixture/repo' WHERE id=$1",[p])
  await assert.rejects(projects.save(p,a,{yaml:projectYaml,expectedRevision:2}),{status:409})
  assert.equal((await q('SELECT revision FROM projects WHERE id=$1',[p])).rows[0].revision,2)
  assert.equal((await q('SELECT count(*) AS count FROM sync_jobs')).rows[0].count,'0')
  await assert.rejects(projects.restore(p,a,{revision:1,expectedRevision:2}),{status:409})
  await q("INSERT INTO project_members VALUES($1,$2,'editor')",[p,b.id])
  await configure({userRevisions:2})
  await assert.rejects(projects.save(p,b,{yaml:projectYaml,expectedRevision:2}),{status:409})
  assert.equal((await storage.summary(b.id)).usage.revisions,'1')
  await configure({userBlocks:1,blockVersions:2})
  const saved=await blocks.create(a,{yaml:blockYaml,summary:'first'})
  await blocks.save(saved.id,a,{yaml:blockYaml,expectedVersion:1,summary:'second'})
  await assert.rejects(blocks.create(a,{yaml:blockYaml}),{status:409})
  await assert.rejects(blocks.save(saved.id,a,{yaml:blockYaml,expectedVersion:2}),{status:409})
  const legacy={...block,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6X6sAAAAASUVORK5CYII='}
  await q('UPDATE block_versions SET yaml=$2 WHERE block_id=$1 AND version=1',[saved.id,stringify(legacy)])
  await assert.rejects(blocks.restore(saved.id,a,{version:1,expectedVersion:2}),{status:409})
  assert.equal((await q('SELECT count(*) AS count FROM images')).rows[0].count,'0')
  assert.equal((await q('SELECT latest_version FROM blocks WHERE id=$1',[saved.id])).rows[0].latest_version,2)
  await blocks.create(root,{yaml:blockYaml,scope:'catalog'})
  await configure({platformBlocks:3})
  concurrent=await Promise.allSettled([blocks.create(b,{yaml:blockYaml}),blocks.create({id:crypto.randomUUID(),role:'dev'},{yaml:blockYaml})])
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal((await storage.configuration()).usage.blocks,'3')
  const exact=Buffer.byteLength(block.name)+Buffer.byteLength(blockYaml.trim())+Buffer.byteLength('fixture'),fresh={id:crypto.randomUUID(),role:'dev'}
  await configure({userBytes:exact})
  await blocks.create(fresh,{yaml:blockYaml,summary:'fixture'})
  assert.equal((await storage.summary(fresh.id)).usage.bytes,String(exact))
  await assert.rejects(blocks.save(saved.id,a,{yaml:blockYaml,expectedVersion:2}),{status:409})
  const bytes=Number((await storage.configuration()).usage.bytes),newOwner={id:crypto.randomUUID(),role:'dev'}
  await configure({platformBytes:bytes+exact-1});await assert.rejects(blocks.create(newOwner,{yaml:blockYaml,summary:'fixture'}),{status:409})
  await configure({platformBytes:bytes+exact});await blocks.create(newOwner,{yaml:blockYaml,summary:'fixture'})
  const old=await storage.configuration();await configure({userBlocks:0});await assert.rejects(storage.configure({...defaultDocumentStorage,expectedVersion:old.version}),{status:409})
  await initDocumentStorage(q);assert.equal((await storage.configuration()).userBlocks,0)
  const before=(await storage.summary(a.id)).usage;await q('UPDATE blocks SET deleted_at=now() WHERE id=$1',[saved.id]);assert.deepEqual((await storage.summary(a.id)).usage,before)
  assert.equal((await storage.summary(a.id)).limits.platformBytes,undefined)
})
