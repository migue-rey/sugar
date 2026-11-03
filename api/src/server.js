import { createApp } from './app.js'
import { q, initDb, transaction, signingSecret } from './db.js'
import { enqueue, startSync, syncOne } from './github.js'

for (let attempt = 1; ; attempt++) {
  try { await initDb(); break }
  catch (e) {
    if (attempt >= 30) throw e
    console.warn(`Database not ready (${attempt}/30); retrying`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
const secret = await signingSecret()
const app = createApp({ q, transaction, secret, enqueue, syncOne })
startSync()
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('API ready'))
