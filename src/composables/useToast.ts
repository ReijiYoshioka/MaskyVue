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

// ホバー中は自動消去タイマーを止め、外れたら残り時間から再開する。
// id ごとに「タイマー本体・残り時間・直近の開始時刻」を持たせて計算する。
const timers = new Map<number, { timeoutId: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>()

function remove(id: number) {
  const index = toastState.items.findIndex((item) => item.id === id)
  if (index !== -1) toastState.items.splice(index, 1)
  timers.delete(id)
}

function schedule(id: number, ms: number) {
  const timeoutId = setTimeout(() => remove(id), ms)
  timers.set(id, { timeoutId, remaining: ms, startedAt: Date.now() })
}

function push(title: string, message: string, type: ToastMessage['type']) {
  const id = nextId++
  toastState.items.push({ id, title, message, type })
  schedule(id, TOAST_DURATION_MS)
}

function pause(id: number) {
  const timer = timers.get(id)
  if (!timer) return
  clearTimeout(timer.timeoutId)
  timer.remaining -= Date.now() - timer.startedAt
}

function resume(id: number) {
  const timer = timers.get(id)
  if (!timer) return
  schedule(id, Math.max(timer.remaining, 0))
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
    pause,
    resume,
  }
}
