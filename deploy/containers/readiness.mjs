// Only invoked inside disposable Compose. No database credentials or real IO.
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
const down = process.argv[2] === 'down'
let matched = false
for (let attempt = 0; attempt < 30; attempt++) {
  const result = await fetch('http://127.0.0.1:3000/api/ready', { signal: AbortSignal.timeout(4000) })
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  const body = await result.json()
  assert.deepEqual(Object.keys(body), ['ok'])
  if (result.status === (down ? 503 : 200)) {
    assert.equal(body.ok, !down)
    if (down) assert.equal(result.headers.get('retry-after'), '1')
    matched = true
    break
  }
  await delay(150)
}
assert(matched, 'readiness did not reflect dependency state')
const live = await fetch('http://127.0.0.1:3000/api/health')
assert.equal(live.status, 200)
assert.deepEqual(await live.json(), { ok: true })
console.log('PASS: readiness ' + (down ? 'unavailable' : 'recovered') + ', liveness available')
