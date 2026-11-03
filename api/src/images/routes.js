import { asyncRoute } from '../shared/http.js'

export function registerImageContentRoute(app, images) {
  app.get('/api/images/:id/content', asyncRoute(async (req, res) => {
    const image = await images.content(req.params.id)
    res.set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'public, max-age=3600').type(image.mime).send(image.data)
  }))
}
export function registerImageRoutes(app, images) {
  app.get('/api/images', asyncRoute(async (_req, res) => res.json(await images.list())))
  app.post('/api/images', asyncRoute(async (req, res) => res.status(201).json(await images.create(req.user, req.body))))
  app.delete('/api/images/:id', asyncRoute(async (req, res) => { await images.archive(req.params.id, req.user); res.json({ ok: true }) }))
}
