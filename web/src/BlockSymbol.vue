<script setup lang="ts">
import CategorySymbol from './CategorySymbol.vue'
import { blockImage, resolveCategoryIcon, type CategoryIconMap } from './categoryIcons'
import type { Block } from './types'
defineProps<{ block: Partial<Block>; icons: CategoryIconMap }>()
</script>
<template><img v-if="blockImage(block)" :src="blockImage(block)" alt="" class="block-symbol-image"><CategorySymbol v-else :icon="resolveCategoryIcon(block,icons)" /></template>
