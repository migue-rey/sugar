import { performance } from 'node:perf_hooks'
import { schemaVersion } from '../database/access.js'

export const databaseProbe = q => async () => {
  const result = await q({ text: "SELECT value FROM settings WHERE key='schema_version'", query_timeout: 1000 })
  return result.rows?.[0]?.value === schemaVersion
}

// A timeout answers the HTTP caller but retains the in-flight guard until the
// underlying operation settles: repeated polls cannot enqueue unlimited SQL.
export function createReadiness({ probe, timeoutMs = 1500, cacheMs = 1000, clock = () => performance.now() }) {
  let active = null, cached = null
  return function check() {
    if (active) return active.response
    if (cached && clock() - cached.at < cacheMs) return Promise.resolve(cached.ok)
    let resolve
    const state = { response: new Promise(done => { resolve = done }), finished: false }
    active = state
    const finish = ok => {
      if (state.finished) return
      state.finished = true
      clearTimeout(timer)
      cached = { ok, at: clock() }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    Promise.resolve().then(probe).then(value => finish(value === true), () => finish(false)).finally(() => {
      if (active === state) active = null
    })
    return state.response
  }
}
