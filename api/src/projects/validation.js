import { error } from '../shared/http.js'

export function repositorySettings(body) {
  const repository = String(body.sync_repository || '').trim()
  const branch = String(body.sync_branch || 'main').trim()
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) error(400, 'Usa owner/repo para el repositorio')
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) error(400, 'Rama de GitHub inválida')
  return { repository: repository || null, branch }
}
