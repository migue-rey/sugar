<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
const props = defineProps<{ projectId: string; language: 'es' | 'en' }>()
type Member = { user_id: string; email: string; role: 'editor' | 'reader'; active: boolean }
const members = ref<Member[]>([]), email = ref(''), role = ref<'editor' | 'reader'>('reader'), busy = ref(false), error = ref('')
const labels = {
  es: { title: 'Colaboradores', hint: 'Añade cuentas existentes. Editor puede modificar la pizarra; lector solo puede verla. Las cuentas view solo pueden ser lectoras. No se envían correos.', email: 'Correo del colaborador', role: 'Permiso', editor: 'Editor', reader: 'Lector', add: 'Guardar acceso', remove: 'Quitar acceso', empty: 'Sin colaboradores. El propietario y los administradores mantienen acceso.', failed: 'No se pudo actualizar el acceso. Comprueba el correo y los permisos de la cuenta.', inactive: 'Cuenta inactiva' },
  en: { title: 'Collaborators', hint: 'Add existing accounts. Editors can change the board; readers can only view it. Accounts with the view role can only be readers. No emails are sent.', email: 'Collaborator email', role: 'Permission', editor: 'Editor', reader: 'Reader', add: 'Save access', remove: 'Remove access', empty: 'No collaborators. The owner and administrators retain access.', failed: 'Could not update access. Check the email and account permissions.', inactive: 'Inactive account' },
}
const t = computed(() => labels[props.language])
async function request(path = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/projects/${props.projectId}/members${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) throw Error(t.value.failed)
  return response.json()
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await action() } catch { error.value = t.value.failed } finally { busy.value = false }
}
async function save() { await run(async () => { await request('', 'PUT', { email: email.value, role: role.value }); members.value = await request(); email.value = '' }) }
async function remove(member: Member) { await run(async () => { await request('/' + member.user_id, 'DELETE'); members.value = await request() }) }
onMounted(() => run(async () => { members.value = await request() }))
</script>

<template>
  <section class="project-members mt-6 border-t border-[var(--border)] pt-4">
    <h3>{{ t.title }}</h3><p class="hint">{{ t.hint }}</p>
    <p v-if="error" role="alert" class="text-[var(--danger)]">{{ error }}</p>
    <form @submit.prevent="save">
      <label>{{ t.email }}<input v-model="email" type="email" required maxlength="254" :disabled="busy" class="w-full"></label>
      <label :for="`project-member-role-${projectId}`">{{ t.role }}</label><select :id="`project-member-role-${projectId}`" v-model="role" :disabled="busy" class="mb-4 w-full"><option value="reader">{{ t.reader }}</option><option value="editor">{{ t.editor }}</option></select>
      <button class="secondary" :disabled="busy">{{ t.add }}</button>
    </form>
    <p v-if="!members.length" class="hint">{{ t.empty }}</p>
    <div v-for="member in members" :key="member.user_id" class="my-3 rounded-lg border border-[var(--border)] p-3 break-words">
      <strong>{{ member.email }}</strong><p class="hint">{{ member.role === 'editor' ? t.editor : t.reader }}<span v-if="!member.active"> · {{ t.inactive }}</span></p>
      <button class="secondary" :disabled="busy" :aria-label="`${t.remove}: ${member.email}`" @click="remove(member)">{{ t.remove }}</button>
    </div>
  </section>
</template>
