const identifier = value => '"' + value.replaceAll('"', '""') + '"'
const badConfig = () => Object.assign(new Error('Database access configuration requires migration'), { code: 'DATABASE_CONFIG' })
export const schemaVersion = 1

export async function provisionRuntime(transaction, password) {
  if (!/^[a-f0-9]{64}$/i.test(password || '')) throw badConfig()
  await transaction(async q => {
    await q("SELECT pg_advisory_xact_lock(hashtext('sugar:runtime-role'))")
    const { rows: [context] } = await q('SELECT current_database() AS database,current_schema() AS schema,current_user AS owner')
    if (!context.schema || context.owner === 'sugar_runtime') throw badConfig()
    const { rows: [existing] } = await q("SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,oid FROM pg_roles WHERE rolname='sugar_runtime'")
    if (existing && (existing.rolsuper || existing.rolcreaterole || existing.rolcreatedb || existing.rolreplication || existing.rolbypassrls || existing.rolinherit || (await q('SELECT 1 FROM pg_auth_members WHERE member=$1', [existing.oid])).rows.length)) throw badConfig()
    if (existing && (await q('SELECT 1 FROM pg_class WHERE relowner=$1 UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=$1 UNION ALL SELECT 1 FROM pg_database WHERE datdba=$1', [existing.oid])).rows.length) throw badConfig()
    if (!existing) await q('CREATE ROLE sugar_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS')
    const { rows: [statement] } = await q("SELECT format('ALTER ROLE sugar_runtime LOGIN PASSWORD %L', $1::text) AS sql", [password])
    await q(statement.sql)
    const schema = identifier(context.schema), database = identifier(context.database)
    await q(`REVOKE CREATE,TEMPORARY ON DATABASE ${database} FROM PUBLIC`)
    await q(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`)
    await q(`GRANT CONNECT ON DATABASE ${database} TO sugar_runtime`)
    await q(`GRANT USAGE ON SCHEMA ${schema} TO sugar_runtime`)
    await q(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO sugar_runtime`)
    await q(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO sugar_runtime`)
    await q(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO sugar_runtime`)
    await q(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE,SELECT ON SEQUENCES TO sugar_runtime`)
    await q("INSERT INTO settings(key,value) VALUES('schema_version',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(schemaVersion)])
  })
}

export async function verifyRuntime(q) {
  try {
    const { rows: [role] } = await q(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
      has_database_privilege(current_database(),'CREATE') AS db_create,
      has_database_privilege(current_database(),'TEMP') AS db_temp,
      has_schema_privilege(current_schema(),'CREATE') AS schema_create,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
      EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AS owns_objects
      FROM pg_roles r WHERE rolname=current_user`)
    if (!role || Object.values(role).some(Boolean)) throw badConfig()
    if ((await q("SELECT value FROM settings WHERE key='schema_version'")).rows[0]?.value !== schemaVersion) throw badConfig()
  } catch (error) {
    if (['42P01', '42501', 'DATABASE_CONFIG'].includes(error.code)) throw badConfig()
    throw error
  }
}
