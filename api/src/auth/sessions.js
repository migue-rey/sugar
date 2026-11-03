// Session identities are not bearer credentials; only signed JWTs can select them.
export async function initSessionDb(query) {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0')
  await query(`CREATE TABLE IF NOT EXISTS user_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),auth_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz)`)
  await query('CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id)')
}

export function createSessionRepository(query, transaction) {
  return {
    async create(id, userId, expectedHash, expiresAt) {
      return transaction(async tx => {
        const user = (await tx('SELECT auth_version FROM users WHERE id=$1 AND active=true AND password_hash=$2 FOR UPDATE', [userId, expectedHash])).rows[0]
        if (!user) return false
        await tx('INSERT INTO user_sessions(id,user_id,auth_version,expires_at) VALUES($1,$2,$3,$4)', [id, userId, user.auth_version, expiresAt])
        return true
      })
    },
    async user(id, userId) {
      return (await query(`SELECT u.id,u.email,u.role,u.language,u.theme FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true AND u.auth_version=s.auth_version`, [id, userId])).rows[0]
    },
    async revoke(id, userId) { return (await query('UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2', [id, userId])).rowCount },
    async list(userId, currentId) {
      return (await query('SELECT s.id,s.created_at,s.expires_at,(s.id=$2) AS current FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.auth_version=u.auth_version ORDER BY s.created_at DESC', [userId, currentId])).rows
    },
    async revokeOthers(userId, currentId) {
      await transaction(async tx => {
        // Serialize with login / credential changes for this account.
        await tx('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
        await tx('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL', [userId, currentId])
      })
    },
  }
}
