// Server entrypoint only. Run before db.js constructs its connection pool.
import { loadSecretFiles } from './secrets.js'
loadSecretFiles()
