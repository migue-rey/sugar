<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Diagram } from './types'
import { aiApi, aiMessages, stableSnapshot, type Analysis } from './ai'
const props = defineProps<{ projectId: string; revision: number; snapshot: Diagram; yamlDirty: boolean; editable: boolean; language: 'es' | 'en' }>()
const emit = defineEmits<{ select: [id: string] }>()
const t = (key: string) => (aiMessages[props.language] as Record<string,string>)[key] || key
const focus = ref(''), busy = ref(false), loading = ref(false), error = ref(''), available = ref(false), ready = ref(false)
const items = ref<Analysis[]>([]), current = ref<Analysis | null>(null), nextOffset = ref<number | null>(null)
const stale = computed(() => current.value?.snapshot && (props.yamlDirty || stableSnapshot(current.value.snapshot) !== stableSnapshot(props.snapshot)))
const base = '/projects/' + props.projectId + '/analyses'
function showError(e: unknown) { const code = e instanceof Error ? e.message : 'aiNetworkError'; error.value = t(code) === code && !code.startsWith('ai') ? t('aiNetworkError') : t(code) }
async function history(append = false) {
  loading.value = true
  try { const data = await aiApi(base + '?offset=' + (append ? nextOffset.value || 0 : 0)); items.value = append ? [...items.value, ...data.items] : data.items; nextOffset.value = data.nextOffset }
  finally { loading.value = false }
}
async function refresh() { error.value = ''; try { await history() } catch(e) { showError(e) } }
async function select(id: string) { error.value = ''; loading.value = true; try { current.value = await aiApi(base + '/' + id) } catch(e) { showError(e) } finally { loading.value = false } }
onMounted(async () => { try { available.value = (await aiApi('/ai/status')).available; ready.value = true; await history() } catch(e) { showError(e) } })
async function execute(action: 'analyze' | 'recommend') {
  if (busy.value || props.yamlDirty || !props.editable) return
  busy.value = true; error.value = ''
  const snapshot = JSON.parse(JSON.stringify(props.snapshot))
  try { const data = await aiApi(base, 'POST', { snapshot, action, focus: focus.value, language: props.language, baseRevision: props.revision, requestId: crypto.randomUUID() }); current.value = await aiApi(base + '/' + data.id); await history() }
  catch(e) { showError(e) } finally { busy.value = false }
}
async function more() { try { await history(true) } catch(e) { showError(e) } }
</script>
<template>
  <div class="inspector-content ai-panel">
    <h2>{{ t('aiReview') }}</h2>
    <template v-if="editable">
      <p class="hint">{{ t('aiDisclosure') }}</p>
      <p v-if="ready && !available" class="message error">{{ t('aiUnavailable') }}</p>
      <label>{{ t('aiFocus') }}<textarea v-model="focus" maxlength="2000" rows="3" :placeholder="t('aiFocusHint')" :disabled="busy"></textarea></label>
      <p class="hint">{{ focus.length }}/2000 · {{ t('aiSnapshotHint') }}</p>
      <p v-if="yamlDirty" class="message error">{{ t('aiYamlPending') }}</p>
      <div class="ai-actions"><button class="primary" :disabled="busy || !available || yamlDirty || !snapshot.nodes.length" @click="execute('analyze')">{{ t('aiAnalyze') }}</button><button class="secondary" :disabled="busy || !available || yamlDirty || !snapshot.nodes.length" @click="execute('recommend')">{{ t('aiRecommend') }}</button></div>
      <p v-if="!snapshot.nodes.length" class="hint">{{ t('aiEmptyProject') }}</p>
    </template><p v-else class="hint">{{ t('aiReadOnly') }}</p>
    <p v-if="busy" class="hint" role="status">{{ t('aiPending') }}</p><p v-if="error" class="message error" role="alert">{{ error }}</p>
    <article v-if="current" class="ai-result" :aria-label="t('aiSnapshot')">
      <p v-if="stale" class="message error">{{ t('aiStale') }}</p>
      <h3>{{ current.action === 'analyze' ? t('aiAnalyze') : t('aiRecommend') }}</h3>
      <p class="hint">{{ new Date(current.created_at).toLocaleString(language) }} · {{ current.author }}<br>{{ current.provider }} / {{ current.model }} · {{ t('aiBase') }} {{ current.base_revision }}<br>{{ t('aiSnapshot') }}: {{ current.snapshot_hash.slice(0,12) }}</p>
      <p v-if="current.focus" class="hint">{{ t('aiFocus') }}: {{ current.focus }}</p>
      <p class="ai-response">{{ current.response }}</p>
      <p class="hint">{{ t('aiCaution') }}</p>
      <details v-if="current.snapshot"><summary>{{ t('aiSnapshot') }} ({{ current.snapshot.nodes.length }})</summary><div v-for="node in current.snapshot.nodes" :key="node.id" class="ai-node"><button class="link-button" :disabled="!snapshot.nodes.some(n => n.id === node.id)" :title="t('aiSelectBlock')" @click="emit('select',node.id)">{{ node.block.name }}</button><small>{{ node.id }}</small></div></details>
      <p v-if="current.usage?.total_tokens != null" class="hint">{{ t('aiUsage') }}: {{ current.usage.total_tokens }}</p>
    </article>
    <div class="section-heading"><h3>{{ t('aiHistory') }}</h3><button class="link-button" :disabled="loading" @click="refresh">{{ t('aiReload') }}</button></div>
    <p v-if="!items.length && !loading" class="hint">{{ t('aiNoHistory') }}</p>
    <button v-for="item in items" :key="item.id" class="ai-history-item" :class="{ chosen: current?.id === item.id }" :disabled="loading" @click="select(item.id)"><strong>{{ item.action === 'analyze' ? t('aiAnalyze') : t('aiRecommend') }} · v{{ item.base_revision }}</strong><small>{{ new Date(item.created_at).toLocaleString(language) }} · {{ item.author }}</small><span v-if="item.focus">{{ item.focus }}</span></button>
    <button v-if="nextOffset !== null" class="secondary wide" :disabled="loading" @click="more">{{ t('aiMore') }}</button>
  </div>
</template>
