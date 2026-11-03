<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { aiApi, aiMessages } from './ai'
const props = defineProps<{ language: 'es' | 'en' }>()
const config = ref<Record<string, number> | null>(null), busy = ref(false), error = ref(''), saved = ref(false)
const fields = [
  ['periodHours','Periodo (horas)','Period (hours)',1,744],
  ['userRequests','Solicitudes por cuenta','Requests per account',0,1000000000],
  ['globalRequests','Solicitudes de la plataforma','Platform requests',0,1000000000],
  ['userTokens','Presupuesto de tokens por cuenta','Token budget per account',0,1000000000],
  ['globalTokens','Presupuesto de tokens de la plataforma','Platform token budget',0,1000000000],
  ['maxConcurrent','Consultas simultáneas de la plataforma','Concurrent platform requests',1,32],
] as const
const t = (key: string) => (aiMessages[props.language] as Record<string,string>)[key] || key
async function run(task: () => Promise<void>) { busy.value = true; error.value = ''; saved.value = false; try { await task() } catch(e) { error.value = t(e instanceof Error ? e.message : 'aiNetworkError') } finally { busy.value = false } }
async function load() { await run(async () => { config.value = await aiApi('/ai/quotas') }) }
async function save() { await run(async () => { if (!config.value) return; config.value = await aiApi('/ai/quotas','PUT',{ ...config.value, expectedVersion: config.value.version }); saved.value = true }) }
onMounted(load)
</script>
<template>
  <section class="content-card ai-settings">
    <h2>{{ t('aiQuotaTitle') }}</h2><p class="hint">{{ language === 'es' ? 'Presupuestos de solicitudes y tokens; no representan dinero ni el saldo de DeepSeek. Se reserva una estimación conservadora antes de llamar. Los fallos sin consumo confirmado conservan la reserva. Las pruebas de conexión también cuentan.' : 'Request and token budgets, not money or DeepSeek account balance. A conservative allowance is reserved before calling. Failures without confirmed usage retain the reservation. Connection tests also count.' }}</p>
    <p v-if="error" class="message error" role="alert">{{ error }}</p><p v-if="saved" role="status">{{ t('aiSave') }} ✓</p>
    <fieldset v-if="config" :disabled="busy"><label v-for="[key,es,en,min,max] in fields" :key="key">{{ language === 'es' ? es : en }}<input v-model.number="config[key]" type="number" :min="min" :max="max" step="1" required></label><div class="ai-actions"><button class="primary" @click="save">{{ t('aiSave') }}</button><button class="secondary" @click="load">{{ t('aiReload') }}</button></div></fieldset>
  </section>
</template>
