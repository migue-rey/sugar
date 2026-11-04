import { asyncRoute } from '../shared/http.js'

export function registerRecoveryRoutes(app, { recovery, gate }) {
  app.get('/api/recovery', (_req, res) => res.json({ enabled: recovery.enabled }))
  app.post('/api/recovery/request', gate, asyncRoute(async (req, res) => { await recovery.requestReset(req.body); res.status(202).json({ ok: true }) }))
  app.post('/api/recovery/reset', gate, asyncRoute(async (req, res) => {
    res.locals.auditActor = await recovery.reset(req.body)
    res.clearCookie('session', { path: '/' }); res.json({ ok: true })
  }))
  app.post('/api/recovery/confirm-email', gate, asyncRoute(async (req, res) => {
    const result = await recovery.confirmEmail(req.body)
    if (!result.pending) { res.locals.auditActor = result.id; res.clearCookie('session', { path: '/' }) }
    res.json({ ok: true, pending: result.pending })
  }))
}
export function registerAccountEmailRoutes(app, { recovery, gate }) {
  app.get('/api/me/email', asyncRoute(async (req, res) => res.json(await recovery.status(req.user))))
  app.post('/api/me/email', gate, asyncRoute(async (req, res) => { await recovery.requestEmail(req.user, req.body); res.status(202).json({ ok: true }) }))
}
