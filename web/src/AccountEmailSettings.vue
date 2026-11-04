<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { messages } from './i18n'
import { sessionRequest } from './sessionRequest'
const props = defineProps<{ language: 'es' | 'en' }>()
const t = (key: string) => (messages[props.language] as Record<string, string>)[key] || key
const email = ref(''), currentEmail = ref(''), currentPassword = ref(''), verified = ref(false), enabled = ref(false), busy = ref(false), failure = ref(''), sent = ref(false)
async function request(method = 'GET', body?: unknown) {
  const response = await sessionRequest('/api/me/email', { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json()
  if (!response.ok) throw Error(response.status === 429 ? t('rateLimitWait').replace('{seconds}', response.headers.get('Retry-After') || '60') : value.error || t('recoveryFailed'))
  return value
}
async function run(task: () => Promise<void>) {
  busy.value = true; failure.value = ''
  try { await task() } catch (e) { failure.value = e instanceof Error ? e.message : t('recoveryFailed') }
  finally { busy.value = false }
}
async function submit() { sent.value = false; await run(async () => { await request('POST', { email: email.value, currentPassword: currentPassword.value }); currentPassword.value = ''; sent.value = true }) }
onMounted(() => run(async () => { const value = await request(); currentEmail.value = value.email; email.value = value.email; verified.value = value.verified; enabled.value = value.enabled }))
</script>
<template>
  <section class="content-card">
    <h2>{{ t('accountEmail') }}</h2><p>{{ currentEmail }}</p><p>{{ t(verified ? 'emailVerified' : 'emailUnverified') }}</p>
    <p class="hint">{{ t('emailChangeHint') }}</p>
    <p v-if="!enabled" class="hint">{{ t('recoveryDisabled') }}</p>
    <form v-else @submit.prevent="submit">
      <label>{{ t('emailToVerify') }}<input v-model="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>{{ t('currentPassword') }}<input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="1024" required></label>
      <button class="primary" :disabled="busy">{{ t('requestEmailChange') }}</button>
    </form>
    <p v-if="sent" role="status">{{ t('emailChangeSent') }}</p><p v-if="failure" class="message error" role="alert">{{ failure }}</p>
  </section>
</template>
