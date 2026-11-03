<script setup lang="ts">
import { sessionRequest } from './sessionRequest'
import { onMounted, ref } from 'vue'
const props = defineProps<{ language: 'es' | 'en' }>()
type Session = { id: string; created_at: string; expires_at: string; current: boolean }
const sessions = ref<Session[]>([]), busy = ref(false), error = ref(''), notice = ref('')
const text = () => props.language === 'es' ? {
  title: 'Sesiones activas', hint: 'Las sesiones caducan a los 7 días. Cerrar una sesión bloquea sus siguientes solicitudes.',
  current: 'Esta sesión', created: 'Inicio', expires: 'Caduca', close: 'Cerrar sesión', others: 'Cerrar otras sesiones', refresh: 'Actualizar', closed: 'Sesiones actualizadas', failed: 'No se pudieron actualizar las sesiones',
} : {
  title: 'Active sessions', hint: 'Sessions expire after 7 days. Closing a session blocks its next requests.',
  current: 'This session', created: 'Started', expires: 'Expires', close: 'Close session', others: 'Close other sessions', refresh: 'Refresh', closed: 'Sessions updated', failed: 'Could not update sessions',
}
async function request(path = '', method = 'GET') {
  const res = await sessionRequest('/api/me/sessions' + path, { method })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Error(body.error || text().failed)
  return body
}
async function refresh() {
  busy.value = true; error.value = ''
  try { sessions.value = await request() } catch (e) { error.value = e instanceof Error ? e.message : text().failed } finally { busy.value = false }
}
async function close(path: string, method: string) {
  busy.value = true; error.value = ''; notice.value = ''
  try { await request(path, method); sessions.value = await request(); notice.value = text().closed }
  catch (e) { error.value = e instanceof Error ? e.message : text().failed } finally { busy.value = false }
}
onMounted(refresh)
</script>
<template>
  <section class="content-card">
    <h2>{{ text().title }}</h2><p class="hint">{{ text().hint }}</p>
    <div class="header-actions"><button class="secondary" :disabled="busy" @click="refresh">{{ text().refresh }}</button><button class="secondary" :disabled="busy || !sessions.some(s => !s.current)" @click="close('/revoke-others', 'POST')">{{ text().others }}</button></div>
    <p v-if="error" role="alert" class="message error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <div v-for="session in sessions" :key="session.id" class="history-item">
      <strong v-if="session.current">{{ text().current }}</strong>
      <p>{{ text().created }}: {{ new Date(session.created_at).toLocaleString(language) }}</p><small>{{ text().expires }}: {{ new Date(session.expires_at).toLocaleString(language) }}</small>
      <button v-if="!session.current" class="link-button" :disabled="busy" @click="close('/' + session.id, 'DELETE')">{{ text().close }}</button>
    </div>
  </section>
</template>
