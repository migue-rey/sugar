import express from 'express'
import cookieParser from 'cookie-parser'
import { asyncRoute, errorHandler } from './shared/http.js'
import { requireAdmin, requireEdit } from './auth/policies.js'
import { createSessionRepository } from './auth/sessions.js'
import { createAccessControls, limitsConfig, proxyList } from './security/limits.js'
import { apiHeaders, publicOrigin, requestOrigin } from './security/headers.js'
import { createAuthService } from './auth/service.js'
import { authenticate, registerAuthRoutes, registerSessionRoutes } from './auth/routes.js'
import { createUserRepository } from './users/repository.js'
import { createUserService } from './users/service.js'
import { registerUserRoutes } from './users/routes.js'
import { createProjectRepository } from './projects/repository.js'
import { createProjectService } from './projects/service.js'
import { registerProjectRoutes, registerPublicProjectRoutes } from './projects/routes.js'
import { createBlockRepository } from './blocks/repository.js'
import { createBlockService } from './blocks/service.js'
import { registerBlockRoutes } from './blocks/routes.js'
import { createImageRepository } from './images/repository.js'
import { createImageService } from './images/service.js'
import { registerImageContentRoute, registerImageRoutes } from './images/routes.js'
import { registerCategoryRoutes } from './categories/routes.js'
import { projectCategoryIcons, validateCategory } from './categories.js'
import { replaceEmbeddedImages } from './images.js'
import { registerDocumentRoutes } from './documents.js'
import { createAiQuotas } from './ai/quotas.js'
import { registerAi } from './ai.js'
import { createProjectSyncService } from './github.js'
import { registerSyncRoutes } from './github/routes.js'
import { createReadiness, databaseProbe } from './monitoring/readiness.js'

// Composition only: no DB initialization, listener, timers or background workers.
// Query, transaction, session secret and GitHub operations belong to the caller.
export function createApp({ q, transaction, secret, enqueue, syncOne, callProvider, sessionSecure = process.env.SESSION_SECURE === 'true', accessConfig = limitsConfig(), trustedProxies = process.env.TRUSTED_PROXIES || '', origin = process.env.PUBLIC_ORIGIN || '' }) {
  const app = express()
  app.set('trust proxy', proxyList(trustedProxies))
  app.disable('x-powered-by')
  app.disable('etag')
  app.use('/api', apiHeaders, requestOrigin(publicOrigin(origin)))
  const controls = createAccessControls({ secret, config: accessConfig })
  app.use('/api', controls.api)
  app.post(['/api/login', '/api/me/password', '/api/users'], express.json({ limit: '4kb' }))
  app.use(express.json({ limit: '3mb' }))
  app.use(cookieParser())

  const userRepository = createUserRepository(q, transaction)
  const auth = createAuthService({ users: userRepository, sessions: createSessionRepository(q, transaction), secret, runCredential: controls.runCredential })
  const images = createImageService(createImageRepository(q))
  const projects = createProjectService({
    projects: createProjectRepository(q), transaction, enqueue,
    categoryIcons: yaml => projectCategoryIcons(yaml, q), replaceEmbeddedImages, attachImages: images.attach,
  })
  const blocks = createBlockService({ blocks: createBlockRepository(q), transaction, validateCategory, replaceEmbeddedImages, attachImages: images.attach })
  const sync = createProjectSyncService({ query: q, projects, synchronize: syncOne })

  // Public endpoints must precede the session middleware, just as before.
  app.get('/api/health', (_, res) => res.json({ ok: true }))
  const ready = createReadiness({ probe: databaseProbe(q) })
  app.get('/api/ready', asyncRoute(async (_req, res) => {
    const ok = await ready()
    if (!ok) res.set('Retry-After', '1')
    res.status(ok ? 200 : 503).json({ ok })
  }))
  registerImageContentRoute(app, images, auth)
  registerPublicProjectRoutes(app, projects)
  registerAuthRoutes(app, { auth, sessionSecure, loginGate: controls.login })
  app.use('/api', authenticate(auth))

  app.post('/api/me/password', controls.credentials)
  app.post('/api/users', controls.credentials)
  registerSessionRoutes(app, auth)
  registerImageRoutes(app, images)
  registerDocumentRoutes(app, q)
  registerUserRoutes(app, createUserService(userRepository, { runCredential: controls.runCredential }))
  registerCategoryRoutes(app, { query: q, transaction })
  registerBlockRoutes(app, blocks)
  registerProjectRoutes(app, projects)
  registerSyncRoutes(app, sync)
  // Preserve the established AI module and its request-based policy interface.
  registerAi(app, {
    q, callProvider, quota: createAiQuotas({ q, transaction }),
    requireAdmin: req => requireAdmin(req.user),
    requireEdit: req => requireEdit(req.user),
    requireProject: (req, edit = false, ownerOnly = false) => projects.get(req.params.id, req.user, { edit, ownerOnly }),
  })
  app.use(errorHandler)
  return app
}
