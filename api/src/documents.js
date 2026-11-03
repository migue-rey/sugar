import { asyncRoute, error } from './shared/http.js'
import { validateBlock, validateProject } from './model.js'
import { validateCategory } from './categories.js'

export function registerDocumentRoutes(app, query) {
  app.post('/api/validate', asyncRoute(async (req, res) => {
    if (req.body.kind === 'project') validateProject(req.body.yaml)
    else if (req.body.kind === 'block') await validateCategory(validateBlock(req.body.yaml), query)
    else error(400, 'Tipo de documento inválido')
    res.json({ ok: true })
  }))
}
