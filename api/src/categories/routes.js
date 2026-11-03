import { asyncRoute } from '../shared/http.js'
import { requireEdit } from '../auth/policies.js'
import { archiveCategory, createCategory, listCategories, renameCategory } from '../categories.js'

// Category validation and transactional operations already live in categories.js.
export function registerCategoryRoutes(app, { query, transaction }) {
  app.get('/api/categories', asyncRoute(async (req, res) => res.json(await listCategories(query, req.user))))
  app.post('/api/categories', asyncRoute(async (req, res) => {
    requireEdit(req.user)
    res.status(201).json(await transaction(tx => createCategory(req.body.name, req.body.parentId || null, tx, req.body.icon, req.user, req.body.scope)))
  }))
  app.patch('/api/categories/:id', asyncRoute(async (req, res) => {
    requireEdit(req.user)
    res.json(await transaction(tx => renameCategory(req.params.id, req.body.name, tx, req.body.icon, req.user)))
  }))
  app.delete('/api/categories/:id', asyncRoute(async (req, res) => {
    requireEdit(req.user)
    await transaction(tx => archiveCategory(req.params.id, tx, req.user))
    res.json({ ok: true })
  }))
}
