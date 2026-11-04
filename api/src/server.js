import './config/load-env.js'
import { reportFailure } from './shared/logging.js'
import { createApp } from './app.js'
import { q, pool, transaction, signingSecret } from './db.js'
import { verifyRuntime } from './database/access.js'
import { enqueue, startSync, syncOne } from './github.js'
import { registrationConfig } from './registration/config.js'
import { registrationSchemaReady } from './registration/repository.js'
import { createMailService } from './mail/service.js'

async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await verifyRuntime(q); break }
    catch (e) {
      if (attempt >= 30 || ['DATABASE_CONFIG','SECRET_CONFIG'].includes(e.code)) throw e
      reportFailure('Database startup retry', e)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  const secret = await signingSecret()
  const registration = registrationConfig()
  if (registration.enabled && !(await registrationSchemaReady(q))) throw Object.assign(Error('Registration requires database migration'), { code: 'DATABASE_CONFIG' })
  const mail = createMailService({ q })
  if (registration.enabled) await mail.assertConfigured()
  const app = createApp({ q, transaction, secret, enqueue, syncOne, registrationConfig: registration, mailService: mail })
  startSync()
  const listener = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('API ready', listener.address().port))
}
await start().catch(async error => { reportFailure('API startup failed', error); await pool.end(); process.exitCode = 1 })
