import { ref, shallowRef } from 'vue'
type Page<T> = { items: T[]; nextCursor: string | null }

export function usePagedList<T extends { id: string }>(request: (path: string) => Promise<Page<T>>, endpoint: string) {
  const items = shallowRef<T[]>([]), cursor = ref<string | null>(null), loading = ref(false)
  let generation = 0
  function reset() { generation++; items.value = []; cursor.value = null; loading.value = false }
  async function load(first: boolean) {
    if (first) reset()
    else if (loading.value || !cursor.value) return
    const current = generation, after = first ? null : cursor.value
    loading.value = true
    try {
      const result = await request(endpoint + '?limit=30' + (after ? '&cursor=' + encodeURIComponent(after) : ''))
      if (current !== generation) return
      const merged = new Map((first ? [] : items.value).map(item => [item.id, item]))
      for (const item of result.items) merged.set(item.id, item)
      items.value = [...merged.values()]; cursor.value = result.nextCursor
    } catch (e) { if (current === generation) throw e }
    finally { if (current === generation) loading.value = false }
  }
  return { items, cursor, loading, reset, first: () => load(true), more: () => load(false) }
}
