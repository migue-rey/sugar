import test from 'node:test'
import assert from 'node:assert/strict'
import { stringify, validateBlock, validateProject } from './model.js'

const controller = { name: 'Controlador', function: 'Procesar', ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 2 }] }
const sensor = { name: 'Sensor', function: 'Medir', ports: [{ id: 'i2c', label: 'I²C', protocol: 'I2C', direction: 'bidirectional', maxConnections: 1 }] }
const node = (id, block) => ({ id, position: { x: 0, y: 0 }, block })

test('validates a portable diagram with two I2C endpoints', () => {
  const doc = { name: 'Termómetro', nodes: [node('mcu', controller), node('sensor', sensor)], edges: [{ id: 'e1', source: 'mcu', sourcePort: 'i2c', target: 'sensor', targetPort: 'i2c' }] }
  assert.equal(validateProject(stringify(doc)).edges.length, 1)
})
test('rejects incompatible protocols and excess connections', () => {
  const spi = { ...sensor, ports: [{ ...sensor.ports[0], protocol: 'SPI' }] }
  const doc = { name: 'Test', nodes: [node('mcu', controller), node('sensor', spi)], edges: [{ id: 'e1', source: 'mcu', sourcePort: 'i2c', target: 'sensor', targetPort: 'i2c' }] }
  assert.throws(() => validateProject(stringify(doc)), /Protocolos incompatibles/)
  doc.nodes[1].block = sensor
  doc.edges.push({ id: 'e2', source: 'mcu', sourcePort: 'i2c', target: 'sensor', targetPort: 'i2c' })
  assert.throws(() => validateProject(stringify(doc)), /Límite de conexiones/)
})
test('rejects malformed blocks and duplicate YAML keys', () => {
  assert.throws(() => validateBlock('name: Test\nname: Again\n'), /name/)
  assert.throws(() => validateBlock(stringify({ name: 'Test', function: 'x', ports: [] })), /puerto/)
})
test('accepts portable images and rejects unsafe image URLs', () => {
  assert.equal(validateBlock(stringify({ ...sensor, image: 'data:image/png;base64,aGVsbG8=' })).image.startsWith('data:image/png'), true)
  assert.equal(validateBlock(stringify({ ...sensor, image: 'https://example.com/sensor.png' })).image, 'https://example.com/sensor.png')
  assert.throws(() => validateBlock(stringify({ ...sensor, image: 'javascript:alert(1)' })), /image debe ser/)
})
