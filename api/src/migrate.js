import './config/load-env.js'
import { pool, initDb, transaction } from './db.js'
import { provisionRuntime } from './database/access.js'
import { reportFailure } from './shared/logging.js'

try {
  if (!/^[a-f0-9]{64}$/i.test(process.env.RUNTIME_DB_PASSWORD || '')) throw Object.assign(new Error('Invalid migration configuration'), { code: 'DATABASE_CONFIG' })
  const lock = await pool.connect()
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext(current_database()),hashtext(current_schema()))')
    await initDb()
    await provisionRuntime(transaction, process.env.RUNTIME_DB_PASSWORD)
    console.log('Database migration complete')
  } finally { try { await lock.query('SELECT pg_advisory_unlock(hashtext(current_database()),hashtext(current_schema()))') } finally { lock.release() } }
} catch (error) { reportFailure('Database migration failed', error); process.exitCode = 1 }
finally { await pool.end() }
