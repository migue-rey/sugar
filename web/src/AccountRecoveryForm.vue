<script setup lang="ts">
import { ref } from 'vue'
import { messages } from './i18n'
const props = defineProps<{ language: 'es' | 'en'; kind: 'request' | 'reset' | 'email_change'; token: string; enabled: boolean }>()
const emit = defineEmits<{ cancel: []; complete: [kind: 'reset' | 'email_change'] }>()
const email = ref(''), password = ref(''), confirm = ref(''), sent = ref(false), pending = ref(false), busy = ref(false), failure = ref('')
const t = (key: string) => (messages[props.language] as Record<string, string>)[key] || key
async function submit() {
  failure.value = ''
  if (props.kind === 'reset' && password.value !== confirm.value) { failure.value = t('passwordMismatch'); return }
  busy.value = true
  try {
    const path = props.kind === 'email_change' ? 'confirm-email' : props.kind
    const body = props.kind === 'request' ? { email: email.value, language: props.language } : props.kind === 'reset' ? { token: props.token, newPassword: password.value } : { token: props.token, currentPassword: password.value }
    const response = await fetch('/api/recovery/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw Error(response.status === 429 ? t('rateLimitWait').replace('{seconds}', response.headers.get('Retry-After') || '60') : value.error || t('recoveryFailed'))
    password.value = ''; confirm.value = ''
    if (props.kind === 'request') sent.value = true
    else if (value.pending) pending.value = true
    else emit('complete', props.kind)
  } catch (e) { failure.value = e instanceof Error ? e.message : t('recoveryFailed') }
  finally { busy.value = false }
}
</script>
<template>
  <section>
    <h1>{{ t(kind === 'email_change' ? 'confirmAccountEmail' : 'recoverAccount') }}</h1>
    <p>{{ t(kind === 'email_change' ? 'confirmEmailHint' : 'recoveryHint') }}</p>
    <p v-if="!enabled" role="status">{{ t('recoveryDisabled') }}</p>
    <p v-else-if="pending" role="status">{{ t('emailSecondConfirmation') }}</p>
    <form v-else @submit.prevent="submit">
      <label v-if="kind === 'request'">{{ t('email') }}<input v-model="email" type="email" autocomplete="email" maxlength="254" required></label>
      <template v-else>
        <label>{{ t(kind === 'reset' ? 'newPassword' : 'currentPassword') }}<input v-model="password" type="password" :autocomplete="kind === 'reset' ? 'new-password' : 'current-password'" :minlength="kind === 'reset' ? 12 : 1" :maxlength="kind === 'reset' ? 72 : 1024" required></label>
        <template v-if="kind === 'reset'"><p class="hint">{{ t('registrationPasswordHint') }}</p><label>{{ t('confirmPassword') }}<input v-model="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label></template>
      </template>
      <button class="primary wide" :disabled="busy">{{ t(kind === 'request' ? 'sendRecovery' : kind === 'reset' ? 'resetPassword' : 'confirmAccountEmail') }}</button>
    </form>
    <p v-if="sent" role="status">{{ t('recoverySent') }}</p><p v-if="failure" class="message error" role="alert">{{ failure }}</p>
    <button class="link-button" :disabled="busy" @click="emit('cancel')">{{ t('backToSignIn') }}</button>
  </section>
</template>
