<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { BaseEdge, getSmoothStepPath, useVueFlow, type EdgeProps } from '@vue-flow/core'

type Point = { x: number; y: number }
const props = defineProps<EdgeProps<{ route?: Point; editable?: boolean }>>()
const { screenToFlowCoordinate, updateEdgeData } = useVueFlow()
const automatic = computed(() => getSmoothStepPath({
  sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
  targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition
}))
const control = computed<Point>(() => props.data?.route || { x: automatic.value[1], y: automatic.value[2] })
const path = computed(() => {
  const route = props.data?.route
  if (!route) return automatic.value[0]
  // Four orthogonal segments let the bend move independently of both ports.
  return `M ${props.sourceX} ${props.sourceY} H ${route.x} V ${route.y} H ${props.targetX} V ${props.targetY}`
})
let dragging = false
function move(event: PointerEvent) {
  if (!dragging) return
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  updateEdgeData(props.id, { route: { x: Math.round(point.x), y: Math.round(point.y) } })
}
function stop() {
  dragging = false
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}
function start(event: PointerEvent) {
  if (!props.data?.editable) return
  event.preventDefault()
  event.stopPropagation()
  dragging = true
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
onBeforeUnmount(stop)
</script>

<template>
  <BaseEdge :id="id" :path="path" :label="label" :label-x="control.x" :label-y="control.y - 20" :marker-end="markerEnd" :interaction-width="24" />
  <circle v-if="data?.editable && selected" class="edge-route-handle-hit" :cx="control.x" :cy="control.y" r="16" @pointerdown="start" />
  <circle v-if="data?.editable && selected" class="edge-route-handle" :cx="control.x" :cy="control.y" r="7" @pointerdown="start" />
</template>
