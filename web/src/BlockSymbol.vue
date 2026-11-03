<script setup lang="ts">
import { inject } from 'vue'
import CategorySymbol from './CategorySymbol.vue'
import { blockImage, resolveCategoryIcon, type CategoryIconMap } from './categoryIcons'
import type { Block } from './types'
const imageUrl = inject<(url: string) => string>('imageUrl', url => url)
defineProps<{ block: Partial<Block>; icons: CategoryIconMap }>()
</script>
<template><img v-if="blockImage(block)" :src="imageUrl(blockImage(block))" referrerpolicy="no-referrer" alt="" class="block-symbol-image"><CategorySymbol v-else :icon="resolveCategoryIcon(block,icons)" /></template>
