<script setup lang="ts">
import { computed, ref } from 'vue'
import CategorySymbol from './CategorySymbol.vue'
import { categorySymbols, iconNames, type CategoryIconKey } from './categoryIcons'
const props = defineProps<{ modelValue: string | null; language: 'es' | 'en'; inheritable?: boolean; inheritedIcon?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: CategoryIconKey | null] }>()
const search = ref(''), details = ref<HTMLDetailsElement | null>(null)
const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const choices = computed(() => (Object.keys(categorySymbols) as CategoryIconKey[]).filter(key => normalize(iconNames[props.language][key] + ' ' + key).includes(normalize(search.value))))
const chooseText = computed(() => props.language === 'es' ? 'Seleccionar icono' : 'Select icon')
const inheritText = computed(() => props.language === 'es' ? 'Heredar de categoría principal' : 'Inherit from parent category')
const label = computed(() => props.modelValue === null && props.inheritable ? inheritText.value : iconNames[props.language][props.modelValue as CategoryIconKey] || chooseText.value)
function select(value: CategoryIconKey | null) { emit('update:modelValue',value); if (details.value) details.value.open = false; search.value = '' }
</script>
<template>
  <details ref="details" class="icon-picker">
    <summary :aria-label="chooseText + ': ' + label"><CategorySymbol :icon="modelValue || inheritedIcon" /><span>{{ label }}</span></summary>
    <div class="icon-picker-menu">
      <input v-model="search" type="search" :aria-label="language === 'es' ? 'Buscar iconos' : 'Search icons'" :placeholder="language === 'es' ? 'Buscar iconos' : 'Search icons'">
      <button v-if="inheritable" type="button" class="icon-inherit" :aria-pressed="modelValue === null" @click="select(null)"><CategorySymbol :icon="inheritedIcon" />{{ inheritText }}</button>
      <div class="icon-picker-grid"><button v-for="key in choices" :key="key" type="button" :aria-pressed="modelValue === key" @click="select(key)"><CategorySymbol :icon="key" /><span>{{ iconNames[language][key] }}</span></button></div>
      <p v-if="!choices.length" class="hint">{{ language === 'es' ? 'Sin resultados' : 'No results' }}</p>
    </div>
  </details>
</template>
