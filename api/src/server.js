import './config/load-env.js'
import { reportFailure } from './shared/logging.js'
import { createApp } from './app.js'
import { q, pool, initDb, transaction, signingSecret } from './db.js'
import { enqueue, startSync, syncOne } from './github.js'

async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await initDb(); break }
    catch (e) {
      if (attempt >= 30 || ['BOOTSTRAP_CONFIG','SECRET_CONFIG'].includes(e.code)) throw e
      reportFailure('Database startup retry', e)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  const secret = await signingSecret()
  const app = createApp({ q, transaction, secret, enqueue, syncOne })
  startSync()
  const listener = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('API ready', listener.address().port))
}
await start().catch(async error => { reportFailure('API startup failed', error); await pool.end(); process.exitCode = 1 })
