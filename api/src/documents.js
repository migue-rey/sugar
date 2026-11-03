import { asyncRoute, error } from './shared/http.js'
import { validateBlock, validateProject } from './model.js'
import { validateCategory } from './categories.js'
import { createBlockRepository } from './blocks/repository.js'
import { requireLibraryAccess } from './library/access.js'

export function registerDocumentRoutes(app, query) {
  app.post('/api/validate', asyncRoute(async (req, res) => {
    if (req.body.kind === 'project') validateProject(req.body.yaml)
    else if (req.body.kind === 'block') {
      let ownerId = req.body.scope === 'catalog' ? null : req.user.id
      if (req.body.blockId) ownerId = requireLibraryAccess(await createBlockRepository(query).find(req.body.blockId), req.user).owner_id
      await validateCategory(validateBlock(req.body.yaml), query, false, ownerId)
    }
    else error(400, 'Tipo de documento inválido')
    res.json({ ok: true })
  }))
}
