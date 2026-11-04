import { asyncRoute, noStore } from '../shared/http.js'
import { requireAdmin } from '../auth/policies.js'
export function registerDocumentStorageRoutes(app, storage) {
  app.get('/api/me/document-storage', noStore, asyncRoute(async (req, res) => res.json(await storage.summary(req.user.id))))
  app.get('/api/document-storage', noStore, asyncRoute(async (req, res) => { requireAdmin(req.user); res.json(await storage.configuration()) }))
  app.put('/api/document-storage', noStore, asyncRoute(async (req, res) => { requireAdmin(req.user); res.json(await storage.configure(req.body)) }))
}
