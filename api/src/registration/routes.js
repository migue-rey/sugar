import { asyncRoute } from '../shared/http.js'

export function registerRegistrationRoutes(app, { registration, gate }) {
  app.get('/api/registration', (_req, res) => res.json({ enabled: registration.enabled }))
  app.post('/api/registration/request', gate, asyncRoute(async (req, res) => {
    await registration.request(req.body)
    res.status(202).json({ ok: true })
  }))
  app.post('/api/registration/verify', gate, asyncRoute(async (req, res) => {
    res.locals.auditActor = await registration.verify(req.body)
    res.json({ ok: true })
  }))
}
