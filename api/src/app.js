import express from 'express'
import cookieParser from 'cookie-parser'
import { errorHandler } from './shared/http.js'
import { requireAdmin, requireEdit } from './auth/policies.js'
import { createSessionRepository } from './auth/sessions.js'
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
import { registerAi } from './ai.js'
import { createProjectSyncService } from './github.js'
import { registerSyncRoutes } from './github/routes.js'

// Composition only: no DB initialization, listener, timers or background workers.
// Query, transaction, session secret and GitHub operations belong to the caller.
export function createApp({ q, transaction, secret, enqueue, syncOne, callProvider, sessionSecure = process.env.SESSION_SECURE === 'true' }) {
  const app = express()
  app.use(express.json({ limit: '3mb' }))
  app.use(cookieParser())
  app.disable('x-powered-by')

  const userRepository = createUserRepository(q, transaction)
  const auth = createAuthService({ users: userRepository, sessions: createSessionRepository(q, transaction), secret })
  const images = createImageService(createImageRepository(q))
  const projects = createProjectService({
    projects: createProjectRepository(q), transaction, enqueue,
    categoryIcons: yaml => projectCategoryIcons(yaml, q), replaceEmbeddedImages, attachImages: images.attach,
  })
  const blocks = createBlockService({ blocks: createBlockRepository(q), transaction, validateCategory, replaceEmbeddedImages, attachImages: images.attach })
  const sync = createProjectSyncService({ query: q, projects, synchronize: syncOne })

  // Public endpoints must precede the session middleware, just as before.
  app.get('/api/health', (_, res) => res.json({ ok: true }))
  registerImageContentRoute(app, images, auth)
  registerPublicProjectRoutes(app, projects)
  registerAuthRoutes(app, { auth, sessionSecure })
  app.use('/api', authenticate(auth))

  registerSessionRoutes(app, auth)
  registerImageRoutes(app, images)
  registerDocumentRoutes(app, q)
  registerUserRoutes(app, createUserService(userRepository))
  registerCategoryRoutes(app, { query: q, transaction })
  registerBlockRoutes(app, blocks)
  registerProjectRoutes(app, projects)
  registerSyncRoutes(app, sync)
  // Preserve the established AI module and its request-based policy interface.
  registerAi(app, {
    q, callProvider,
    requireAdmin: req => requireAdmin(req.user),
    requireEdit: req => requireEdit(req.user),
    requireProject: (req, edit = false, ownerOnly = false) => projects.get(req.params.id, req.user, { edit, ownerOnly }),
  })
  app.use(errorHandler)
  return app
}
