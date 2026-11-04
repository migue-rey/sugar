export async function initRecoveryDb(q) {
  await q(`CREATE TABLE IF NOT EXISTS account_actions (
    kind text NOT NULL CHECK(kind IN ('reset','email_change')), email text NOT NULL,
    token_hash text UNIQUE NOT NULL, old_token_hash text UNIQUE, user_id uuid REFERENCES users(id), auth_version integer,
    old_email text, old_confirmed boolean NOT NULL DEFAULT true, new_confirmed boolean NOT NULL DEFAULT false,
    language text NOT NULL CHECK(language IN ('es','en')), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
    PRIMARY KEY(kind,email)
  )`)
  await q('CREATE INDEX IF NOT EXISTS account_actions_expiry ON account_actions(expires_at)')
  await q('CREATE UNIQUE INDEX IF NOT EXISTS account_actions_email_user ON account_actions(user_id) WHERE kind=\'email_change\'')
}
export async function recoverySchemaReady(q) {
  return (await q({ text: "SELECT value FROM settings WHERE key='recovery_schema_version'", query_timeout: 1000 })).rows[0]?.value === 1
}

export function createRecoveryRepository(q, transaction) {
  const lookup = async (hash, kind, execute = q, lock = false) => (await execute(`SELECT a.* FROM account_actions a
    WHERE a.kind=$2 AND (a.token_hash=$1 OR a.old_token_hash=$1) AND a.expires_at>now()${lock ? ' FOR UPDATE' : ''}`, [hash, kind])).rows[0]
  return {
    lookup,
    async user(id) { return (await q('SELECT id,email,password_hash,auth_version,email_verified_at,language FROM users WHERE id=$1 AND active=true', [id])).rows[0] },
    async reserve({ kind, email, tokenHash, oldTokenHash = null, language, user }) {
      return transaction(async tx => {
        await tx("SELECT pg_advisory_xact_lock(hashtext('sugar:account-actions'))")
        await tx('DELETE FROM account_actions WHERE expires_at<=now()')
        const cooling = (await tx(`SELECT 1 FROM account_actions WHERE created_at>now()-interval '1 minute' AND
          ((kind=$1 AND email=$2) OR (kind='email_change' AND user_id=$3))`, [kind, email, user?.id || null])).rowCount
        if (cooling) return false
        if (kind === 'email_change') {
          // Recheck the authenticated credential snapshot after bcrypt, without locking the user before the token row.
          if (!(await tx('SELECT 1 FROM users WHERE id=$1 AND active=true AND password_hash=$2 AND auth_version=$3', [user.id, user.password_hash, user.auth_version])).rowCount) return false
          await tx("DELETE FROM account_actions WHERE kind='email_change' AND user_id=$1", [user.id])
        }
        const existing = (await tx('SELECT 1 FROM account_actions WHERE kind=$1 AND email=$2', [kind, email])).rowCount
        if (!existing && (await tx('SELECT count(*)::int AS n FROM account_actions')).rows[0].n >= 10000) return false
        let account = user
        if (kind === 'reset') {
          const candidates = (await tx('SELECT id,auth_version,email FROM users WHERE lower(email)=$1 AND active=true AND email_verified_at IS NOT NULL', [email])).rows
          // Ambiguous legacy spellings must never select an arbitrary identity.
          account = candidates.length === 1 ? candidates[0] : undefined
        }
        await tx(`INSERT INTO account_actions(kind,email,token_hash,old_token_hash,user_id,auth_version,old_email,old_confirmed,language,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+interval '15 minutes') ON CONFLICT(kind,email) DO UPDATE SET
          token_hash=excluded.token_hash,old_token_hash=excluded.old_token_hash,user_id=excluded.user_id,auth_version=excluded.auth_version,
          old_email=excluded.old_email,old_confirmed=excluded.old_confirmed,new_confirmed=false,language=excluded.language,created_at=now(),expires_at=excluded.expires_at`,
        [kind, email, tokenHash, oldTokenHash, account?.id || null, account?.auth_version ?? null, account?.email || null, !oldTokenHash, language])
        return true
      })
    },
    async discard(hash) { await q('DELETE FROM account_actions WHERE token_hash=$1 OR old_token_hash=$1', [hash]) },
    async reset(hash, passwordHash) {
      return transaction(async tx => {
        const action = await lookup(hash, 'reset', tx, true)
        if (!action) return null
        await tx('DELETE FROM account_actions WHERE token_hash=$1', [hash])
        if (!action.user_id) return null
        const user = (await tx('SELECT id,email,auth_version,language FROM users WHERE id=$1 AND active=true AND email_verified_at IS NOT NULL FOR UPDATE', [action.user_id])).rows[0]
        if (!user || user.auth_version !== action.auth_version || user.email.toLowerCase() !== action.email) return null
        await tx('UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1', [user.id, passwordHash])
        await tx('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id])
        return user
      })
    },
    async confirmEmail(hash, expectedHash) {
      return transaction(async tx => {
        const action = await lookup(hash, 'email_change', tx, true)
        if (!action || (hash === action.old_token_hash ? action.old_confirmed : action.new_confirmed)) return null
        const user = (await tx('SELECT id,email,password_hash,auth_version,language FROM users WHERE id=$1 AND active=true FOR UPDATE', [action.user_id])).rows[0]
        if (!user || user.password_hash !== expectedHash || user.auth_version !== action.auth_version || user.email !== action.old_email) return null
        const oldConfirmed = action.old_confirmed || hash === action.old_token_hash, newConfirmed = action.new_confirmed || hash === action.token_hash
        if (!oldConfirmed || !newConfirmed) {
          await tx('UPDATE account_actions SET old_confirmed=$2,new_confirmed=$3 WHERE token_hash=$1', [action.token_hash, oldConfirmed, newConfirmed])
          return { pending: true }
        }
        await tx('DELETE FROM account_actions WHERE token_hash=$1', [action.token_hash])
        if ((await tx('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [action.email, user.id])).rowCount) return null
        await tx('UPDATE users SET email=$2,email_verified_at=now(),auth_version=auth_version+1 WHERE id=$1', [user.id, action.email])
        await tx('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id])
        return { ...user, newEmail: action.email, pending: false }
      })
    },
  }
}
