import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'good' | 'critical'
}

export const useToastStore = defineStore('toast', () => {
  const items = ref<Toast[]>([])
  let seq = 0

  function push(text: string, kind: Toast['kind'] = 'info', timeout = 3600) {
    const id = ++seq
    items.value.push({ id, text, kind })
    window.setTimeout(() => dismiss(id), timeout)
  }
  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id)
  }

  return { items, push, dismiss }
})
