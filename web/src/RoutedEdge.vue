<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { BaseEdge, useVueFlow, type EdgeProps } from '@vue-flow/core'

import { resolveRoute, routePoints, routeControls, moveRoute, type Point, type EdgeRoute, type ResolvedRoute, type RouteControl } from './edgeRouting'
const props = defineProps<EdgeProps<{ route?: EdgeRoute; editable?: boolean; color?: string; labelColor?: string }>>()
const { screenToFlowCoordinate, updateEdgeData } = useVueFlow()

// Preserve legacy routes and allow each vertical leg to move independently.
const source = computed<Point>(() => ({ x: props.sourceX, y: props.sourceY }))
const target = computed<Point>(() => ({ x: props.targetX, y: props.targetY }))
const route = computed(() => resolveRoute(source.value, target.value, props.data?.route))
const points = computed(() => routePoints(source.value, target.value, route.value))
const controls = computed(() => routeControls(source.value, target.value, route.value))
const labelPoint = computed(() => {
  const preferred = controls.value.find(control => control.field === 'y') || controls.value[0]
  return preferred?.point || { x: (props.sourceX + props.targetX) / 2, y: props.sourceY }
})

function roundedPath(raw: Point[], radius = 12) {
  const corners = raw.filter((point, index) => !index || point.x !== raw[index - 1].x || point.y !== raw[index - 1].y)
  if (!corners.length) return ''
  if (corners.length === 1) return `M ${corners[0].x} ${corners[0].y}`
  let result = `M ${corners[0].x} ${corners[0].y}`
  for (let i = 1; i < corners.length - 1; i++) {
    const previous = corners[i - 1], current = corners[i], next = corners[i + 1]
    const incoming = Math.hypot(current.x - previous.x, current.y - previous.y)
    const outgoing = Math.hypot(next.x - current.x, next.y - current.y)
    const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x)
    if (!cross || !incoming || !outgoing) { result += ` L ${current.x} ${current.y}`; continue }
    const bend = Math.min(radius, incoming / 2, outgoing / 2)
    const before = { x: current.x - (current.x - previous.x) / incoming * bend, y: current.y - (current.y - previous.y) / incoming * bend }
    const after = { x: current.x + (next.x - current.x) / outgoing * bend, y: current.y + (next.y - current.y) / outgoing * bend }
    result += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`
  }
  const last = corners[corners.length - 1]
  return result + ` L ${last.x} ${last.y}`
}
const path = computed(() => roundedPath(points.value))

let drag: { control: RouteControl; pointerId: number; start: Point; original?: EdgeRoute; resolved: ResolvedRoute } | null = null
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const axis = drag.control.axis
  const next = moveRoute(drag.original, drag.resolved, drag.control.field, position[axis] - drag.start[axis])
  updateEdgeData(props.id, { route: next })
}
function stop() {
  drag = null
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}
function start(control: RouteControl, event: PointerEvent) {
  if (!props.data?.editable) return
  event.preventDefault()
  event.stopPropagation()
  stop()
  drag = { control, pointerId: event.pointerId, start: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }), original: props.data?.route ? { ...props.data.route } : undefined, resolved: { ...route.value } }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
onBeforeUnmount(stop)
</script>

<template>
  <BaseEdge :id="id" :path="path" fill="none" :label="label" :label-style="{ fill: data?.labelColor || '#28241f' }" :label-x="labelPoint.x" :label-y="labelPoint.y - 18" :marker-end="markerEnd" :interaction-width="24" :style="data?.color ? { stroke: data.color } : undefined" />
  <template v-if="data?.editable && selected">
    <g v-for="control in controls" :key="control.field" class="edge-route-control" :data-route-control="control.field" :transform="`translate(${control.point.x} ${control.point.y})`" @pointerdown="start(control, $event)">
      <circle class="edge-route-handle-hit" r="17" />
      <circle class="edge-route-handle" r="7" />
    </g>
  </template>
</template>
