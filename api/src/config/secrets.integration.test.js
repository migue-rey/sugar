import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import pg from 'pg'
const databaseUrl=process.env.API_TEST_DATABASE_URL

test('server starts with private file secrets before DB construction, without logging credentials', {skip:!databaseUrl},async t=>{
  const pool=new pg.Pool({connectionString:databaseUrl}),schema='secret_start_'+crypto.randomUUID().replaceAll('-','')
  await pool.query(`CREATE SCHEMA ${schema}`)
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sugar-start-')),password='private-bootstrap-fixture-password',email='file-bootstrap@local',jwt='isolated-jwt-key-at-least-thirty-two-bytes',key='a'.repeat(64)
  const connection=new URL(databaseUrl);connection.searchParams.set('options','-c search_path='+schema)
  const env={...process.env,ADMIN_EMAIL:email,PORT:'0'}
  const secrets={DATABASE_URL:connection.href,ADMIN_PASSWORD:password,JWT_SECRET:jwt,AI_ENCRYPTION_KEY:key}
  for(const name of ['DATABASE_URL','ADMIN_PASSWORD','JWT_SECRET','AI_ENCRYPTION_KEY','GITHUB_PRIVATE_KEY','GITHUB_APP_ID','GITHUB_INSTALLATION_ID']){delete env[name];delete env[name+'_FILE']}
  for(const [name,value]of Object.entries(secrets)){const file=path.join(dir,name.toLowerCase());fs.writeFileSync(file,value+'\n',{mode:0o600});env[name+'_FILE']=file}
  let output='',port
  const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../..',import.meta.url),env,stdio:['ignore','pipe','pipe']})
  let exited=false;child.once('exit',()=>{exited=true})
  child.stdout.on('data',data=>{output+=data;const match=output.match(/API ready (\d+)/);if(match)port=Number(match[1])})
  child.stderr.on('data',data=>{output+=data})
  t.after(async()=>{if(!exited){child.kill();await new Promise(resolve=>child.once('exit',resolve))}await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();fs.rmSync(dir,{recursive:true,force:true})})
  const until=Date.now()+15000
  while(!port&&!exited&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,25))
  assert.ok(port,'Secret-file fixture server did not become ready')
  const base=`http://127.0.0.1:${port}/api`
  assert.equal((await fetch(base+'/health')).status,200)
  const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200)
  assert.equal((await login.json()).role,'Admin')
  const cookie=login.headers.get('set-cookie').split(';')[0]
  assert.equal((await fetch(base+'/me',{headers:{cookie}})).status,200)
  for(const value of [...Object.values(secrets),email,dir])assert.equal(output.includes(value),false)
  assert.match(output,/Initial administrator created/)
})
