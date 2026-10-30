<script setup lang="ts">
import YAML from 'yaml'
import { CpuChipIcon, PlusIcon } from '@heroicons/vue/24/outline'
import type { LibraryItem } from './types'

const props = defineProps<{ item: LibraryItem; mode: 'palette' | 'library'; selectedId?: string | null; editable: boolean }>()
const emit = defineEmits<{ select: [id: string]; add: [item: LibraryItem]; dragstart: [event: DragEvent, item: LibraryItem] }>()
function image() {
  try {
    const url = YAML.parse(props.item.yaml)?.image
    return typeof url === 'string' && (url.startsWith('https://') || /^\/api\/images\/[0-9a-f-]{36}\/content$/.test(url)) ? url : ''
  } catch { return '' }
}
</script>

<template>
  <div v-if="mode === 'palette'" class="palette-item catalog-block" :draggable="editable" @dragstart="emit('dragstart', $event, item)">
    <span class="palette-icon"><img v-if="image()" :src="image()" alt="" class="h-7 w-7 rounded-md object-cover"><template v-else><CpuChipIcon class="ui-icon" aria-hidden="true" /></template></span>
    <div><strong>{{ item.name }}</strong><small>v{{ item.latest_version }}</small></div>
    <button v-if="editable" class="add-small" :aria-label="`Agregar ${item.name}`" @click="emit('add', item)"><PlusIcon class="ui-icon" aria-hidden="true" /></button>
  </div>
  <button v-else class="catalog-block library-block" :class="{chosen: selectedId === item.id}" @click="emit('select', item.id)">
    <span class="palette-icon"><img v-if="image()" :src="image()" alt="" class="h-7 w-7 rounded-md object-cover"><template v-else><CpuChipIcon class="ui-icon" aria-hidden="true" /></template></span>
    <span><strong>{{ item.name }}</strong><small>v{{ item.latest_version }}</small></span>
  </button>
</template>
