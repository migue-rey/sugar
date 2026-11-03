import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSecretFiles } from './secrets.js'

test('file secrets enforce permissions, reject links/conflicts and never echo contents or paths', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sugar-secret-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const file=path.join(dir,'private-input'), value='isolated-sensitive-fixture-123456789'
  fs.writeFileSync(file,value+'\n',{mode:0o600})
  const env={ADMIN_PASSWORD_FILE:file};loadSecretFiles(env);assert.equal(env.ADMIN_PASSWORD,value)
  for(const mode of [0o644,0o640,0o666,0o755]){fs.chmodSync(file,mode);assert.throws(()=>loadSecretFiles({ADMIN_PASSWORD_FILE:file}),e=>{assert.equal(e.code,'SECRET_CONFIG');assert.equal(e.message.includes(value),false);assert.equal(e.message.includes(file),false);return true})}
  fs.chmodSync(file,0o400);loadSecretFiles({ADMIN_PASSWORD_FILE:file})
  fs.symlinkSync(file,path.join(dir,'link'));assert.throws(()=>loadSecretFiles({ADMIN_PASSWORD_FILE:path.join(dir,'link')}),{code:'SECRET_CONFIG'})
  assert.throws(()=>loadSecretFiles({ADMIN_PASSWORD:'existing',ADMIN_PASSWORD_FILE:file}),{code:'SECRET_CONFIG'})
  assert.throws(()=>loadSecretFiles({JWT_SECRET:'short'}),{code:'SECRET_CONFIG'})
  assert.throws(()=>loadSecretFiles({AI_ENCRYPTION_KEY:'invalid'}),{code:'SECRET_CONFIG'})
  fs.chmodSync(file,0o600);fs.writeFileSync(file,'x'.repeat(65537));assert.throws(()=>loadSecretFiles({ADMIN_PASSWORD_FILE:file}),{code:'SECRET_CONFIG'})
  fs.writeFileSync(file,'');assert.throws(()=>loadSecretFiles({ADMIN_PASSWORD_FILE:file}),{code:'SECRET_CONFIG'})
})
