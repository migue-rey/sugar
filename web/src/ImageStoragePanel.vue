<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { sessionRequest } from './sessionRequest'
import { messages } from './i18n'
const props = defineProps<{ language: 'es' | 'en'; admin?: boolean; refreshKey?: number }>()
type Usage = { files: string; bytes: string }
type Config = { userFiles: number; userBytes: number; platformFiles: number; platformBytes: number; version: number; usage: Usage; limits?: { userFiles: number; userBytes: number } }
const config = ref<Config | null>(null), busy = ref(false), error = ref(''), saved = ref(false)
let generation = 0
const fields = ['userFiles', 'userBytes', 'platformFiles', 'platformBytes'] as const
const t = (key: string) => (messages[props.language] as Record<string, string>)[key] || key
const cap = computed(() => props.admin ? { files: config.value?.platformFiles, bytes: config.value?.platformBytes } : { files: config.value?.limits?.userFiles, bytes: config.value?.limits?.userBytes })
async function load(method = 'GET', body?: unknown) {
  const current = ++generation
  busy.value = true; error.value = ''; saved.value = false
  try {
    const response = await sessionRequest(props.admin ? '/api/image-storage' : '/api/me/image-storage', { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || t('imageStorageFailed'))
    if (current === generation) { config.value = result; saved.value = method === 'PUT' }
  } catch (e) { if (current === generation) error.value = e instanceof Error ? e.message : t('imageStorageFailed') }
  finally { if (current === generation) busy.value = false }
}
async function save() {
  if (!props.admin || !config.value || busy.value) return
  await load('PUT', { ...Object.fromEntries(fields.map(key => [key, config.value![key]])), expectedVersion: config.value.version })
}
watch(() => props.refreshKey, () => load())
onMounted(() => load())
onUnmounted(() => { generation++ })
</script>

<template>
  <section class="content-card image-storage-panel">
    <h2>{{ t(admin ? 'imageStorageTitle' : 'imageStorageUsage') }}</h2>
    <p class="hint">{{ t('imageStorageHint') }}</p>
    <p v-if="admin" class="hint">{{ t('imageStorageAdminHint') }}</p>
    <p v-if="error" class="message error" role="alert">{{ error }}</p><p v-if="saved" role="status">{{ t('imageStorageSaved') }}</p>
    <template v-if="config"><p>{{ t('imageStorageFiles') }}: {{ config.usage.files }} / {{ cap.files }}</p><p>{{ t('imageStorageBytes') }}: {{ config.usage.bytes }} / {{ cap.bytes }}</p></template>
    <form v-if="admin && config" @submit.prevent="save"><fieldset :disabled="busy"><label v-for="key in fields" :key="key">{{ t('imageStorage_' + key) }}<input v-model.number="config[key]" type="number" min="0" step="1" required></label><button class="primary" type="submit">{{ t('saveSettings') }}</button></fieldset></form>
    <button class="secondary" type="button" :disabled="busy" @click="load()">{{ t('imageStorageReload') }}</button>
  </section>
</template>
