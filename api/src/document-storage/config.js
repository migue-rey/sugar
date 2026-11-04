import { error } from '../shared/http.js'
export const defaultDocumentStorage = Object.freeze({ userProjects: 100, platformProjects: 1000, userBlocks: 500, platformBlocks: 5000, projectRevisions: 100, blockVersions: 100, userRevisions: 10_000, platformRevisions: 100_000, userBytes: 100_000_000, platformBytes: 1_000_000_000 })
export function validateDocumentStorage(input) {
  if (!input || Object.keys(input).some(key => ![...Object.keys(defaultDocumentStorage), 'expectedVersion'].includes(key))) error(400, 'Cuota documental inválida / Invalid document quota')
  return Object.fromEntries(Object.keys(defaultDocumentStorage).map(key => {
    const value = input[key], max = key.endsWith('Bytes') ? 10_000_000_000_000 : 10_000_000
    if (!Number.isSafeInteger(value) || value < 0 || value > max) error(400, 'Cuota documental inválida / Invalid document quota')
    return [key, value]
  }))
}
