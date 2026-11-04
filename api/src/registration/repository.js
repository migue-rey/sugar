export async function initRegistrationDb(q) {
  await q(`CREATE TABLE IF NOT EXISTS pending_registrations (
    email text PRIMARY KEY, token_hash text UNIQUE NOT NULL, language text NOT NULL CHECK(language IN ('es','en')),
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
  )`)
  await q('CREATE INDEX IF NOT EXISTS pending_registrations_expiry ON pending_registrations(expires_at)')
  // Legacy and administrator-created accounts retain their existing access policy.
  await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz')
}

export async function registrationSchemaReady(q) {
  return (await q({ text: "SELECT value FROM settings WHERE key='registration_schema_version'", query_timeout: 1000 })).rows[0]?.value === 1
}

export function createRegistrationRepository(q, transaction) {
  return {
    async reserve(email, tokenHash, language) {
      return transaction(async tx => {
        // Bound pending storage and serialize rotation/capacity across replicas.
        await tx("SELECT pg_advisory_xact_lock(hashtext('sugar:registration'))")
        await tx('DELETE FROM pending_registrations WHERE expires_at<=now()')
        const row = (await tx('SELECT created_at>now()-interval \'1 minute\' AS cooling FROM pending_registrations WHERE email=$1', [email])).rows[0]
        if (row?.cooling) return false
        if (!row && (await tx('SELECT count(*)::int AS n FROM pending_registrations')).rows[0].n >= 10000) return false
        await tx(`INSERT INTO pending_registrations(email,token_hash,language,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')
          ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,language=excluded.language,created_at=now(),expires_at=excluded.expires_at`, [email, tokenHash, language])
        return true
      })
    },
    async valid(tokenHash) { return (await q('SELECT 1 FROM pending_registrations WHERE token_hash=$1 AND expires_at>now()', [tokenHash])).rowCount > 0 },
    async discard(tokenHash) { await q('DELETE FROM pending_registrations WHERE token_hash=$1', [tokenHash]) },
    async consume(tokenHash, id, hash) {
      return transaction(async tx => {
        const pending = (await tx('DELETE FROM pending_registrations WHERE token_hash=$1 AND expires_at>now() RETURNING email,language', [tokenHash])).rows[0]
        if (!pending) return null
        // Never reactivate an account, replace credentials, or grant global privileges.
        return (await tx(`INSERT INTO users(id,email,password_hash,role,language,email_verified_at)
          SELECT $1,$2,$3,'dev',$4,now() WHERE NOT EXISTS(SELECT 1 FROM users WHERE lower(email)=$2)
          ON CONFLICT(email) DO NOTHING RETURNING id`, [id, pending.email, hash, pending.language])).rows[0]?.id || null
      })
    },
  }
}
