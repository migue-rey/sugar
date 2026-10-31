<script setup lang="ts">
import { categorySymbols } from './categoryIcons'
import type { CategoryIconKey } from './categoryIcons'
defineProps<{ icon?: string | null }>()
</script>
<template><component :is="categorySymbols[icon as CategoryIconKey] || categorySymbols.cube" :data-category-icon="icon && icon in categorySymbols ? icon : 'cube'" class="ui-icon" aria-hidden="true" /></template>
