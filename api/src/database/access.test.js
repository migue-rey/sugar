import test from 'node:test'
import assert from 'node:assert/strict'
import { provisionRuntime, verifyRuntime } from './access.js'
test('migration password validation precedes any database write', async () => {
  for (const password of [undefined, '', 'short', 'g'.repeat(64)]) await assert.rejects(provisionRuntime(() => { throw Error('Unexpected transaction') }, password), { code: 'DATABASE_CONFIG' })
})
test('runtime rejects administrative privileges, ownership, membership and missing schema versions', async () => {
  const flags = ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'db_create', 'db_temp', 'schema_create', 'memberships', 'owns_objects']
  for (const flag of flags) await assert.rejects(verifyRuntime(async () => ({ rows: [{ [flag]: true }] })), { code: 'DATABASE_CONFIG' })
  for (const value of [undefined, 0, 2]) await assert.rejects(verifyRuntime(async sql => ({ rows: sql.includes('pg_roles') ? [{}] : [{ value }] })), { code: 'DATABASE_CONFIG' })
  for (const code of ['42P01', '42501']) await assert.rejects(verifyRuntime(async () => { throw Object.assign(Error('private SQL detail'), { code }) }), { code: 'DATABASE_CONFIG' })
  await verifyRuntime(async sql => ({ rows: sql.includes('pg_roles') ? [{}] : [{ value: 1 }] }))
})
