<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { aiApi, aiMessages, type AiConfig } from './ai'
const props = defineProps<{ language: 'es' | 'en' }>()
const t = (key: string) => (aiMessages[props.language] as Record<string,string>)[key] || key
const config = ref<AiConfig>({ provider: 'deepseek', model: 'deepseek-flash', enabled: false, tokenConfigured: false, encryptionReady: false })
const token = ref(''), busy = ref(false), error = ref(''), message = ref(''), loaded = ref(false), saved = ref('')
const dirty = computed(() => !!token.value || JSON.stringify(config.value) !== saved.value)
async function run(fn: () => Promise<void>) { busy.value = true; error.value = ''; message.value = ''; try { await fn() } catch(e) { error.value = e instanceof Error ? e.message : 'aiNetworkError' } finally { busy.value = false } }
function accept(c: AiConfig) { config.value = c; saved.value = JSON.stringify(c); token.value = ''; loaded.value = true }
onMounted(() => run(async () => accept(await aiApi('/ai'))))
async function save(removeToken = false) { await run(async () => { accept(await aiApi('/ai', 'PUT', { provider: config.value.provider, model: config.value.model, enabled: removeToken ? false : config.value.enabled, token: removeToken ? '' : token.value, removeToken })); message.value = t('aiSave') + ' ✓' }) }
async function test() { await run(async () => { await aiApi('/ai/test', 'POST'); message.value = t('aiTestOk') }) }
</script>
<template>
  <section class="content-card ai-settings">
    <h2>{{ t('aiTitle') }}</h2><p class="hint">{{ t('aiConfigHint') }}</p>
    <p v-if="error" class="message error" role="alert">{{ t(error) }}</p><p v-if="message" class="message success" role="status">{{ message }}</p>
    <fieldset :disabled="busy || !loaded">
      <label>{{ t('aiProvider') }}<select v-model="config.provider"><option value="deepseek">DeepSeek</option></select></label>
      <label>{{ language === 'es' ? 'Modelo' : 'Model' }}<select v-model="config.model"><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
      <label>{{ t('aiToken') }}<input v-model="token" type="password" autocomplete="new-password" maxlength="4096" :placeholder="config.tokenConfigured ? '••••••••' : ''"></label>
      <p class="hint">{{ config.tokenConfigured ? t('aiTokenSaved') : t('aiTokenEmpty') }}</p>
      <label class="ai-enable"><input v-model="config.enabled" type="checkbox">{{ t('aiEnabled') }}</label>
      <div class="ai-actions"><button class="primary" @click="save()">{{ t('aiSave') }}</button><button class="secondary" :disabled="!config.tokenConfigured || dirty" @click="test">{{ t('aiTest') }}</button><button v-if="config.tokenConfigured" class="text-danger" @click="save(true)">{{ t('aiRemoveToken') }}</button></div>
    </fieldset>
    <p v-if="loaded && !config.encryptionReady" class="message error">{{ t('aiKeyMissing') }}</p><p class="hint">{{ t('aiEncryptionHint') }}</p>
  </section>
</template>
