import { asyncRoute } from '../shared/http.js'

export function registerBlockRoutes(app, blocks) {
  app.get('/api/blocks', asyncRoute(async (_req, res) => res.json(await blocks.list())))
  app.post('/api/blocks', asyncRoute(async (req, res) => res.status(201).json(await blocks.create(req.user, req.body))))
  app.get('/api/blocks/:id/versions', asyncRoute(async (req, res) => res.json(await blocks.versions(req.params.id))))
  app.get('/api/blocks/:id/versions/:version', asyncRoute(async (req, res) => res.type('text/yaml').send(await blocks.version(req.params.id, req.params.version))))
  app.get('/api/blocks/:id/diff', asyncRoute(async (req, res) => res.type('text/plain').send(await blocks.diff(req.params.id, req.query))))
  app.post('/api/blocks/:id/restore', asyncRoute(async (req, res) => res.json(await blocks.restore(req.params.id, req.user, req.body))))
  app.put('/api/blocks/:id', asyncRoute(async (req, res) => res.json(await blocks.save(req.params.id, req.user, req.body))))
  app.delete('/api/blocks/:id', asyncRoute(async (req, res) => { await blocks.archive(req.params.id, req.user); res.json({ ok: true }) }))
}
