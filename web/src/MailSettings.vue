<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { messages } from './i18n'
import { sessionRequest } from './sessionRequest'
const props = defineProps<{ language: 'es' | 'en' }>()
const t = (key: string) => (messages[props.language] as Record<string, string>)[key] || key
const form = ref({ host: '', port: 587, username: '', from: '', password: '', clearPassword: false })
const configured = ref(false), encryptionReady = ref(false), loaded = ref(false), busy = ref(false), failure = ref(''), notice = ref('')
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await sessionRequest('/api/mail' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (!response.ok) throw Error(value.error || t('mailFailed'))
  return value
}
function apply(value: any) {
  form.value = { host: value.host, port: value.port, username: value.username, from: value.from, password: '', clearPassword: false }
  configured.value = value.password_configured
  encryptionReady.value = value.encryption_ready; loaded.value = true
}
async function run(action: () => Promise<void>) {
  busy.value = true; failure.value = ''; notice.value = ''
  try { await action() } catch (e) { failure.value = e instanceof Error ? e.message : t('mailFailed') }
  finally { busy.value = false }
}
async function save() { await run(async () => { apply(await request('', 'PUT', form.value)); notice.value = t('mailSaved') }) }
async function test() { await run(async () => { await request('/test', 'POST'); notice.value = t('mailConnected') }) }
onMounted(() => run(async () => { apply(await request('')) }))
</script>

<template>
  <section class="content-card">
    <h2>{{ t('mailSettings') }}</h2><p class="hint">{{ t('mailPurpose') }}</p>
    <p v-if="loaded && !encryptionReady" class="message error">{{ t('mailEncryptionMissing') }}</p>
    <form @submit.prevent="save">
      <label>{{ t('mailHost') }}<input v-model="form.host" autocomplete="off" maxlength="254" required></label>
      <label>{{ t('mailPort') }}<select v-model.number="form.port"><option :value="587">587 · STARTTLS</option><option :value="465">465 · TLS</option></select></label>
      <label>{{ t('mailUsername') }}<input v-model="form.username" autocomplete="off" maxlength="254" required></label>
      <label>{{ t('mailFrom') }}<input v-model="form.from" type="email" autocomplete="off" maxlength="254" required></label>
      <p class="hint">{{ configured ? t('mailPasswordConfigured') : t('mailPasswordMissing') }}</p>
      <label>{{ t('password') }}<input v-model="form.password" type="password" autocomplete="new-password" maxlength="4096" :disabled="form.clearPassword"></label>
      <p class="hint">{{ t('mailKeepPassword') }}</p>
      <label v-if="configured"><input v-model="form.clearPassword" type="checkbox" @change="form.password=''"> {{ t('mailRemovePassword') }}</label>
      <div class="header-actions"><button class="primary" :disabled="busy || !loaded || (!!form.password && !encryptionReady)">{{ t('saveSettings') }}</button><button type="button" class="secondary" :disabled="busy || !configured" @click="test">{{ t('mailTest') }}</button></div>
    </form>
    <p v-if="notice" role="status">{{ notice }}</p><p v-if="failure" class="message error" role="alert">{{ failure }}</p>
  </section>
</template>
