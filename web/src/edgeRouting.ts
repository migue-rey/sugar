export type Point = { x: number; y: number }
export type EdgeRoute = { x: number; y: number; targetX?: number }
export type ResolvedRoute = { x: number; y: number; targetX: number }
export type RouteField = keyof ResolvedRoute
export type RouteControl = { field: RouteField; axis: 'x' | 'y'; point: Point; length: number }

export function resolveRoute(source: Point, target: Point, saved?: EdgeRoute): ResolvedRoute {
  return { x: saved?.x ?? Math.round((source.x + target.x) / 2), y: saved?.y ?? target.y, targetX: saved?.targetX ?? target.x }
}
export function routePoints(source: Point, target: Point, route: ResolvedRoute): Point[] {
  return [source, { x: route.x, y: source.y }, { x: route.x, y: route.y }, { x: route.targetX, y: route.y }, { x: route.targetX, y: target.y }, target]
}
export function routeControls(source: Point, target: Point, route: ResolvedRoute): RouteControl[] {
  const controls: RouteControl[] = [
    { field: 'x', axis: 'x', point: { x: route.x, y: (source.y + route.y) / 2 }, length: Math.abs(route.y - source.y) },
    { field: 'y', axis: 'y', point: { x: (route.x + route.targetX) / 2, y: route.y }, length: Math.abs(route.targetX - route.x) },
    { field: 'targetX', axis: 'x', point: { x: route.targetX, y: (route.y + target.y) / 2 }, length: Math.abs(target.y - route.y) },
  ]
  const visible = controls.filter(c => c.length >= 18)
  // When both vertical legs overlap, keep their handles independently reachable.
  const first = visible.find(c => c.field === 'x'), last = visible.find(c => c.field === 'targetX')
  if (first && last && Math.hypot(first.point.x - last.point.x, first.point.y - last.point.y) < 18) {
    first.point.y = source.y + (route.y - source.y) / 3
    last.point.y = route.y + (target.y - route.y) / 3
  }
  return visible
}
export function moveRoute(saved: EdgeRoute | undefined, resolved: ResolvedRoute, field: RouteField, delta: number): EdgeRoute {
  // Do not freeze the target-side leg until the user explicitly adjusts that leg.
  return { ...(saved || { x: resolved.x, y: resolved.y }), [field]: Math.round(resolved[field] + delta) }
}

// Draw arrowheads as ordinary SVG polygons so image exports retain them.
export function arrowHead(points: Point[], end: 'source' | 'target'): string | null {
  const path = end === 'target' ? [...points].reverse() : points
  let remaining = 14
  for (let i = 0; i < path.length - 1; i++) {
    const endpoint = path[i], previous = path[i + 1]
    const length = Math.hypot(previous.x - endpoint.x, previous.y - endpoint.y)
    if (length === 0) continue
    if (remaining > length) { remaining -= length; continue }
    const outward = { x: (endpoint.x - previous.x) / length, y: (endpoint.y - previous.y) / length }
    const tip = { x: endpoint.x - outward.x * remaining, y: endpoint.y - outward.y * remaining }
    const base = { x: tip.x - outward.x * 9, y: tip.y - outward.y * 9 }
    const normal = { x: -outward.y * 4.5, y: outward.x * 4.5 }
    return `${tip.x},${tip.y} ${base.x + normal.x},${base.y + normal.y} ${base.x - normal.x},${base.y - normal.y}`
  }
  return null
}
