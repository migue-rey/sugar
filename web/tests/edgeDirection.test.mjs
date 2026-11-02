import test from 'node:test'
import assert from 'node:assert/strict'
import { isBidirectionalEdge } from '../src/edgeDirection.ts'

const edge = { id: 'e', source: 'a', sourcePort: 'p', target: 'b', targetPort: 'p' }
const diagram = (source, target) => ({ name: 'Directions', edges: [edge], nodes: [
  { id: 'a', position: { x: 0, y: 0 }, block: { name: 'A', function: 'A', ports: [{ id: 'p', label: 'P', protocol: 'PAC', direction: source }] } },
  { id: 'b', position: { x: 100, y: 0 }, block: { name: 'B', function: 'B', ports: [{ id: 'p', label: 'P', protocol: 'PAC', direction: target }] } },
] })

test('only two bidirectional ports need an arrow at each end', () => {
  assert.equal(isBidirectionalEdge(edge, diagram('out', 'in')), false)
  assert.equal(isBidirectionalEdge(edge, diagram('out', 'bidirectional')), false)
  assert.equal(isBidirectionalEdge(edge, diagram('bidirectional', 'in')), false)
  assert.equal(isBidirectionalEdge(edge, diagram('bidirectional', 'bidirectional')), true)
})
