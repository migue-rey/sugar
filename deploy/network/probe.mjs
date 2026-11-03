import net from 'node:net'
import http from 'node:http'
const [mode, target, number] = process.argv.slice(2)
if (mode === 'connect') {
  const socket = net.createConnection({ host: target, port: Number(number) })
  socket.setTimeout(1200)
  socket.on('connect', () => { socket.destroy(); process.exitCode = 0 })
  socket.on('error', () => { process.exitCode = 1 })
  socket.on('timeout', () => { socket.destroy(); process.exitCode = 1 })
} else if (mode === 'serve') {
  const port = { web: 80, api: 3000, db: 5432, external: 8080 }[target]
  if (target === 'db') net.createServer(socket => socket.end('fixture')).listen(port, '0.0.0.0')
  else http.createServer(async (_req, res) => {
    try { res.end(target === 'web' ? await (await fetch('http://api:3000/health')).text() : 'fixture-ok') }
    catch { res.statusCode = 502; res.end('fixture-unavailable') }
  }).listen(port, '0.0.0.0')
} else setInterval(() => {}, 1000)
