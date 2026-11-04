import { error } from '../shared/http.js'

export function repositorySettings(body) {
  const repository = String(body.sync_repository || '').trim()
  const branch = String(body.sync_branch || 'main').trim()
  if (Buffer.byteLength(repository, 'utf8') > 200 || Buffer.byteLength(branch, 'utf8') > 256) error(400, 'Destino GitHub demasiado largo: repositorio máximo 200 bytes, rama 256 / GitHub destination too long: repository maximum 200 bytes, branch 256')
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) error(400, 'Usa owner/repo para el repositorio')
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) error(400, 'Rama de GitHub inválida')
  return { repository: repository || null, branch }
}
