<script setup lang="ts">
import { computed, ref } from 'vue'
import { messages } from './i18n'
const props = defineProps<{ language: 'es' | 'en'; token: string; enabled: boolean }>()
const emit = defineEmits<{ cancel: []; complete: [] }>()
const email = ref(''), password = ref(''), confirm = ref(''), busy = ref(false), sent = ref(false), failure = ref('')
const t = (key: string) => (messages[props.language] as Record<string, string>)[key] || key
const verifying = computed(() => !!props.token)
async function submit() {
  failure.value = ''
  if (verifying.value && password.value !== confirm.value) { failure.value = t('passwordMismatch'); return }
  busy.value = true
  try {
    const response = await fetch('/api/registration/' + (verifying.value ? 'verify' : 'request'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifying.value ? { token: props.token, password: password.value } : { email: email.value, language: props.language }),
    })
    if (!response.ok) {
      if (response.status === 429) throw Error(t('rateLimitWait').replace('{seconds}', response.headers.get('Retry-After') || '60'))
      throw Error((await response.json()).error || t('registrationFailed'))
    }
    password.value = ''; confirm.value = ''
    if (verifying.value) emit('complete')
    else sent.value = true
  } catch (e) { failure.value = e instanceof Error ? e.message : t('registrationFailed') }
  finally { busy.value = false }
}
</script>

<template>
  <section>
    <h1>{{ verifying ? t('verifyEmail') : t('createAccount') }}</h1>
    <p>{{ t('registrationHint') }}</p>
    <p v-if="!enabled" role="status">{{ t('registrationDisabled') }}</p>
    <form v-else @submit.prevent="submit">
      <template v-if="verifying">
        <label>{{ t('newPassword') }}<input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
        <p class="hint">{{ t('registrationPasswordHint') }}</p>
        <label>{{ t('confirmPassword') }}<input v-model="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
      </template>
      <label v-else>{{ t('email') }}<input v-model="email" type="email" autocomplete="email" maxlength="254" required></label>
      <button class="primary wide" :disabled="busy">{{ verifying ? t('verifyAndCreate') : t('sendVerification') }}</button>
    </form>
    <p v-if="sent" role="status">{{ t('verificationSent') }}</p>
    <p v-if="failure" class="message error" role="alert">{{ failure }}</p>
    <button class="link-button" :disabled="busy" @click="emit('cancel')">{{ t('backToSignIn') }}</button>
  </section>
</template>
