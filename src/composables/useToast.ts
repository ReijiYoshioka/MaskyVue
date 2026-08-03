import { reactive } from 'vue'

// index-03.html の toast() に相当する、画面右下に出る通知。
// モジュールスコープの単一状態を共有することで、どのコンポーネントからも
// toast.success(...) / toast.error(...) を呼べば同じ通知キューに積める。
export interface ToastMessage {
  id: number
  title: string
  message: string
  type: 'success' | 'error'
}

const TOAST_DURATION_MS = 3600

let nextId = 1

export const toastState = reactive<{ items: ToastMessage[] }>({ items: [] })

function push(title: string, message: string, type: ToastMessage['type']) {
  const id = nextId++
  toastState.items.push({ id, title, message, type })
  setTimeout(() => {
    const index = toastState.items.findIndex((item) => item.id === id)
    if (index !== -1) toastState.items.splice(index, 1)
  }, TOAST_DURATION_MS)
}

export function useToast() {
  return {
    items: toastState.items,
    success(title: string, message = '') {
      push(title, message, 'success')
    },
    error(title: string, message = '') {
      push(title, message, 'error')
    },
  }
}
