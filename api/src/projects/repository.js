const fields = 'p.id,p.name,p.revision,p.yaml,p.visibility,p.created_by,p.sync_repository,p.sync_branch,p.settings_version,p.created_at,u.email AS creator'
const join = 'FROM projects p LEFT JOIN users u ON u.id=p.created_by'

// Every write participating in a transaction receives that transaction's query function.
export function createProjectRepository(query) {
  return {
    async find(id) { return (await query(`SELECT ${fields} ${join} WHERE p.id=$1 AND p.deleted_at IS NULL`, [id])).rows[0] },
    async public(id) { return (await query(`SELECT ${fields} ${join} WHERE p.id=$1 AND p.visibility='public' AND p.deleted_at IS NULL`, [id])).rows[0] },
    async shared(token) { return (await query(`SELECT ${fields} ${join} WHERE p.share_token=$1 AND p.deleted_at IS NULL`, [token])).rows[0] },
    async list(user) {
      return (await query(`SELECT p.id,p.name,p.revision,p.created_at,p.visibility,p.created_by,p.sync_repository,p.sync_branch,p.settings_version,u.email AS creator ${join} WHERE p.deleted_at IS NULL AND (p.visibility='public' OR p.created_by=$1 OR $2='Admin') ORDER BY p.name`, [user.id, user.role])).rows
    },
    async create(id, name, yaml, authorId, tx) {
      await tx('INSERT INTO projects(id,name,revision,yaml,created_by) VALUES($1,$2,1,$3,$4)', [id, name, yaml, authorId])
    },
    async addRevision(id, revision, yaml, authorId, summary, tx) {
      await tx('INSERT INTO project_revisions(project_id,revision,yaml,author_id,summary) VALUES($1,$2,$3,$4,$5)', [id, revision, yaml, authorId, summary])
    },
    async save(id, expected, name, yaml, tx) {
      return (await tx('UPDATE projects SET name=$3,yaml=$4,revision=revision+1 WHERE id=$1 AND revision=$2 AND deleted_at IS NULL RETURNING revision', [id, expected, name, yaml])).rows[0]
    },
    async settings(id, expected, visibility, repository, branch, tx) {
      return (await tx('UPDATE projects SET share_token=CASE WHEN visibility IS DISTINCT FROM $3 THEN NULL ELSE share_token END,visibility=$3,sync_repository=$4,sync_branch=$5,settings_version=settings_version+1 WHERE id=$1 AND settings_version=$2 AND deleted_at IS NULL RETURNING revision,yaml', [id, expected, visibility, repository, branch])).rows[0]
    },
    async addSettingsHistory(id, authorId, before, after, tx) {
      await tx('INSERT INTO project_settings_history(project_id,author_id,before,after) VALUES($1,$2,$3::jsonb,$4::jsonb)', [id, authorId, JSON.stringify(before), JSON.stringify(after)])
    },
    async skipPendingSync(id, tx) {
      await tx("UPDATE sync_jobs SET status='skipped',error='Destino de sincronización cambiado' WHERE kind='project' AND record_id=$1 AND status='pending'", [id])
    },
    async settingsHistory(id) {
      return (await query('SELECT h.before,h.after,h.created_at,u.email AS author FROM project_settings_history h LEFT JOIN users u ON u.id=h.author_id WHERE h.project_id=$1 ORDER BY h.id DESC', [id])).rows
    },
    async share(id, token) {
      return (await query('UPDATE projects SET share_token=COALESCE(share_token,$2) WHERE id=$1 AND deleted_at IS NULL RETURNING share_token', [id, token])).rows[0].share_token
    },
    async revokeShare(id) { await query('UPDATE projects SET share_token=NULL WHERE id=$1', [id]) },
    async archive(id) { await query('UPDATE projects SET deleted_at=now() WHERE id=$1', [id]) },
    async revisions(id) {
      return (await query('SELECT r.revision,r.summary,r.created_at,u.email AS author FROM project_revisions r LEFT JOIN users u ON u.id=r.author_id WHERE project_id=$1 ORDER BY revision DESC', [id])).rows
    },
    async revision(id, revision) {
      return (await query('SELECT yaml FROM project_revisions WHERE project_id=$1 AND revision=$2', [id, revision])).rows[0]
    },
    async comparison(id, from, to) {
      return (await query('SELECT revision,yaml FROM project_revisions WHERE project_id=$1 AND revision=ANY($2::int[])', [id, [from, to]])).rows
    },
  }
}
