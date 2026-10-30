import YAML from 'yaml'

const directions = ['in', 'out', 'bidirectional']
const fail = (message) => { throw Object.assign(new Error(message), { status: 400 }) }
const object = (v) => v && typeof v === 'object' && !Array.isArray(v)
const string = (v) => typeof v === 'string' && v.trim().length > 0
const webUrl = (v) => {
  if (!string(v) || v.length > 2048) return false
  try { return ['http:', 'https:'].includes(new URL(v).protocol) } catch { return false }
}

export function normalizeColorLiterals(text) { return text.replace(/^([ \t]*color:[ \t]*)(#[0-9a-fA-F]{6})(?=[ \t]*(?:#.*)?\r?$)/gm, '$1"$2"') }

export function parseYaml(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) fail('YAML vacío o demasiado grande')
  const doc = YAML.parseDocument(normalizeColorLiterals(text), { uniqueKeys: true, maxAliasCount: 100 })
  if (doc.errors.length) fail(doc.errors[0].message)
  return doc.toJS({ maxAliasCount: 100 })
}

export function validateBlock(text) {
  const b = parseYaml(text)
  if (!object(b) || !string(b.name) || !string(b.function)) fail('El bloque requiere name y function')
  if (b.model != null && typeof b.model !== 'string') fail('model debe ser texto')
  if (b.image != null && b.image !== '') {
    if (typeof b.image !== 'string' || b.image.length > 2048 || !(b.image.startsWith('https://') || /^\/api\/images\/[0-9a-f-]{36}\/content$/.test(b.image))) fail('image debe ser una URL HTTPS o una ruta de la galería')
    if (b.image.startsWith('https://')) { try { new URL(b.image) } catch { fail('URL de imagen inválida') } }
  }
  if (b.properties != null && !object(b.properties)) fail('properties debe ser un mapa')
  if (b.properties?.url != null && b.properties.url !== '') {
    if (!webUrl(b.properties.url)) fail('properties.url debe ser una URL HTTP o HTTPS')
  }
  if (b.properties?.urls != null) {
    if (!Array.isArray(b.properties.urls)) fail('properties.urls debe ser una lista de enlaces')
    for (const entry of b.properties.urls) {
      if (!object(entry) || Object.keys(entry).length !== 1) fail('Cada elemento de properties.urls debe tener un nombre y una URL')
      const [label, url] = Object.entries(entry)[0]
      if (!string(label) || label.length > 100 || !webUrl(url)) fail('Cada elemento de properties.urls debe tener un nombre y una URL HTTP o HTTPS')
    }
  }
  if (!Array.isArray(b.ports) || b.ports.length === 0) fail('El bloque requiere al menos un puerto')
  const ids = new Set()
  for (const p of b.ports) {
    if (!object(p) || !string(p.id) || !string(p.label) || !string(p.protocol) || !directions.includes(p.direction)) fail('Puerto inválido: id, label, protocol y direction son obligatorios')
    if (ids.has(p.id)) fail(`Puerto duplicado: ${p.id}`)
    ids.add(p.id)
    if ('color' in p && (typeof p.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(p.color))) fail('color debe ser RGB hexadecimal, por ejemplo "#FF0000"')
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
    if (e.route != null && (!object(e.route) || !Number.isFinite(e.route.x) || !Number.isFinite(e.route.y))) fail('La posición de la conexión debe tener coordenadas x e y válidas')
    if (edgeIds.has(e.id)) fail(`Conexión duplicada: ${e.id}`)
    edgeIds.add(e.id)
    const a = nodes.get(e.source), b = nodes.get(e.target)
    if (!a || !b || a === b) fail('La conexión debe unir dos bloques existentes')
    const ap = a.block.ports.find(x => x.id === e.sourcePort), bp = b.block.ports.find(x => x.id === e.targetPort)
    if (!ap || !bp) fail('La conexión referencia un puerto inexistente')
    if (ap.protocol.trim() !== bp.protocol.trim()) fail(`Protocolos incompatibles: ${ap.protocol} y ${bp.protocol}`)
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
