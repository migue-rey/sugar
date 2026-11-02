import type { Diagram } from './types'

export function isBidirectionalEdge(edge: Diagram['edges'][number], diagram: Diagram): boolean {
  const source = diagram.nodes.find(node => node.id === edge.source)?.block.ports.find(port => port.id === edge.sourcePort)
  const target = diagram.nodes.find(node => node.id === edge.target)?.block.ports.find(port => port.id === edge.targetPort)
  return source?.direction === 'bidirectional' && target?.direction === 'bidirectional'
}
