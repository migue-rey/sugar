import YAML from 'yaml'

export const protocols = ['I2C', 'SPI', 'UART', 'GPIO', 'POWER']
const directions = ['in', 'out', 'bidirectional']
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
const string = (v) => typeof v === 'string' && v.trim().length > 0

export function parseYaml(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) fail('YAML vacío o demasiado grande')
  const doc = YAML.parseDocument(text, { uniqueKeys: true, maxAliasCount: 100 })
  if (doc.errors.length) fail(doc.errors[0].message)
  return doc.toJS({ maxAliasCount: 100 })
}

export function validateBlock(text) {
  const b = parseYaml(text)
  if (!object(b) || !string(b.name) || !string(b.function)) fail('El bloque requiere name y function')
  if (b.model != null && typeof b.model !== 'string') fail('model debe ser texto')
  if (b.image != null && b.image !== '') {
    if (typeof b.image !== 'string') fail('image debe ser una URL HTTPS o una imagen incorporada')
    if (b.image.startsWith('data:')) {
      if (b.image.length > 1_500_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.image)) fail('Imagen incorporada inválida o demasiado grande')
    } else {
      try { if (b.image.length > 2048 || new URL(b.image).protocol !== 'https:') fail('image debe ser una URL HTTPS') }
      catch { fail('image debe ser una URL HTTPS') }
    }
  }
  if (b.properties != null && !object(b.properties)) fail('properties debe ser un mapa')
  if (!Array.isArray(b.ports) || b.ports.length === 0) fail('El bloque requiere al menos un puerto')
  const ids = new Set()
  for (const p of b.ports) {
    if (!object(p) || !string(p.id) || !string(p.label) || !protocols.includes(p.protocol) || !directions.includes(p.direction)) fail('Puerto inválido: id, label, protocol y direction son obligatorios')
    if (ids.has(p.id)) fail(`Puerto duplicado: ${p.id}`)
    ids.add(p.id)
    if (p.maxConnections != null && (!Number.isInteger(p.maxConnections) || p.maxConnections < 1)) fail('maxConnections debe ser un entero positivo')
  }
  return b
}

export function validateProject(text) {
  const p = parseYaml(text)
  if (!object(p) || !string(p.name) || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) fail('El proyecto requiere name, nodes y edges')
  const nodes = new Map()
  for (const n of p.nodes) {
    if (!object(n) || !string(n.id) || !object(n.position) || !Number.isFinite(n.position.x) || !Number.isFinite(n.position.y) || !object(n.block)) fail('Nodo inválido')
    validateBlock(YAML.stringify(n.block))
    if (nodes.has(n.id)) fail(`Nodo duplicado: ${n.id}`)
    nodes.set(n.id, n)
  }
  const counts = new Map()
  const edgeIds = new Set()
  for (const e of p.edges) {
    if (!object(e) || !string(e.id) || !string(e.source) || !string(e.target) || !string(e.sourcePort) || !string(e.targetPort)) fail('Conexión inválida')
    if (edgeIds.has(e.id)) fail(`Conexión duplicada: ${e.id}`)
    edgeIds.add(e.id)
    const a = nodes.get(e.source), b = nodes.get(e.target)
    if (!a || !b || a === b) fail('La conexión debe unir dos bloques existentes')
    const ap = a.block.ports.find(x => x.id === e.sourcePort), bp = b.block.ports.find(x => x.id === e.targetPort)
    if (!ap || !bp) fail('La conexión referencia un puerto inexistente')
    if (ap.protocol !== bp.protocol) fail(`Protocolos incompatibles: ${ap.protocol} y ${bp.protocol}`)
    if (ap.direction === 'in' || bp.direction === 'out') fail('Dirección de puertos incompatible')
    for (const [id, port] of [[a.id, ap], [b.id, bp]]) {
      const key = `${id}:${port.id}`, count = (counts.get(key) || 0) + 1
      if (port.maxConnections && count > port.maxConnections) fail(`Límite de conexiones excedido: ${key}`)
      counts.set(key, count)
    }
  }
  return p
}

export const stringify = (value) => YAML.stringify(value, { lineWidth: 0 })
