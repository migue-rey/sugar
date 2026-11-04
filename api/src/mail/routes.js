import { asyncRoute } from '../shared/http.js'
import { requireAdmin } from '../auth/policies.js'

export function registerMailRoutes(app, { mail, gate }) {
  const admin = (req, _res, next) => { requireAdmin(req.user); next() }
  app.get('/api/mail', admin, asyncRoute(async (_req, res) => res.json(await mail.read())))
  app.put('/api/mail', admin, gate, asyncRoute(async (req, res) => res.json(await mail.save(req.body))))
  app.post('/api/mail/test', admin, gate, asyncRoute(async (_req, res) => { await mail.test(); res.json({ ok: true }) }))
}
