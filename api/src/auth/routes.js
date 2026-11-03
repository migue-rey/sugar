import { asyncRoute } from '../shared/http.js'

export function registerAuthRoutes(app, { auth, sessionSecure }) {
  app.post('/api/login', asyncRoute(async (req, res) => {
    const result = await auth.login(req.body)
    res.cookie('session', result.token, { httpOnly: true, sameSite: 'strict', secure: sessionSecure || req.secure, maxAge: 604800000, path: '/' })
    res.json(result.user)
  }))
  app.post('/api/logout', (_, res) => { res.clearCookie('session', { path: '/' }); res.json({ ok: true }) })
}

export function authenticate(auth) {
  return asyncRoute(async (req, _res, next) => {
    req.user = await auth.authenticate(req.cookies.session)
    next()
  })
}
