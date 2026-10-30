<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { BaseEdge, useVueFlow, type EdgeProps } from '@vue-flow/core'

type Point = { x: number; y: number }
type Axis = 'x' | 'y'
const props = defineProps<EdgeProps<{ route?: Point; editable?: boolean; color?: string }>>()
const { screenToFlowCoordinate, updateEdgeData } = useVueFlow()

// Keep default and edited connections on the same rounded, orthogonal route.
const route = computed<Point>(() => props.data?.route || {
  x: Math.round((props.sourceX + props.targetX) / 2),
  y: props.targetY,
})
const points = computed<Point[]>(() => [
  { x: props.sourceX, y: props.sourceY },
  { x: route.value.x, y: props.sourceY },
  { x: route.value.x, y: route.value.y },
  { x: props.targetX, y: route.value.y },
  { x: props.targetX, y: props.targetY },
])
const verticalHandle = computed<Point>(() => ({ x: route.value.x, y: (props.sourceY + route.value.y) / 2 }))
const horizontalHandle = computed<Point>(() => ({ x: (route.value.x + props.targetX) / 2, y: route.value.y }))
const showVerticalHandle = computed(() => Math.abs(route.value.y - props.sourceY) >= 18)
const showHorizontalHandle = computed(() => Math.abs(props.targetX - route.value.x) >= 18)
const labelPoint = computed(() => showHorizontalHandle.value ? horizontalHandle.value : verticalHandle.value)

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

let drag: { axis: Axis; pointerId: number; start: Point; original: Point } | null = null
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const next = { ...drag.original }
  next[drag.axis] = Math.round(drag.original[drag.axis] + position[drag.axis] - drag.start[drag.axis])
  updateEdgeData(props.id, { route: next })
}
function stop() {
  drag = null
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}
function start(axis: Axis, event: PointerEvent) {
  if (!props.data?.editable) return
  event.preventDefault()
  event.stopPropagation()
  stop()
  drag = { axis, pointerId: event.pointerId, start: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }), original: { ...route.value } }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
onBeforeUnmount(stop)
</script>

<template>
  <BaseEdge :id="id" :path="path" :label="label" :label-x="labelPoint.x" :label-y="labelPoint.y - 18" :marker-end="markerEnd" :interaction-width="24" :style="data?.color ? { stroke: data.color } : undefined" />
  <template v-if="data?.editable && selected">
    <g v-if="showVerticalHandle" class="edge-route-control" :transform="`translate(${verticalHandle.x} ${verticalHandle.y})`" @pointerdown="start('x', $event)">
      <circle class="edge-route-handle-hit" r="17" />
      <circle class="edge-route-handle" r="7" />
    </g>
    <g v-if="showHorizontalHandle" class="edge-route-control" :transform="`translate(${horizontalHandle.x} ${horizontalHandle.y})`" @pointerdown="start('y', $event)">
      <circle class="edge-route-handle-hit" r="17" />
      <circle class="edge-route-handle" r="7" />
    </g>
  </template>
</template>
