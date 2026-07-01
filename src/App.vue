<script setup lang="ts">
import { ref } from 'vue'

type CheckState = 'idle' | 'loading' | 'ok' | 'error'

const state = ref<CheckState>('idle')
const detail = ref('')

// user-api の疎通確認。Vite proxy 経由で /api/ → user-api の GET / を叩く。
// 正常時は JSON 文字列 "OK" が返る。
async function checkHealth() {
  state.value = 'loading'
  detail.value = ''
  try {
    const res = await fetch('/api/')
    const body = await res.text()
    if (!res.ok) {
      state.value = 'error'
      detail.value = `HTTP ${res.status}: ${body}`
      return
    }
    state.value = 'ok'
    detail.value = body
  } catch (err) {
    state.value = 'error'
    detail.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <main class="wrap">
    <h1>Masky <small>(Vue)</small></h1>
    <p class="lead">user-api 疎通確認</p>

    <button :disabled="state === 'loading'" @click="checkHealth">
      {{ state === 'loading' ? '確認中…' : 'GET /api/ を叩く' }}
    </button>

    <p v-if="state === 'ok'" class="result ok">✅ 接続成功: {{ detail }}</p>
    <p v-else-if="state === 'error'" class="result error">❌ 失敗: {{ detail }}</p>
    <p v-else-if="state === 'idle'" class="result idle">ボタンを押して疎通を確認してください。</p>
  </main>
</template>

<style scoped>
.wrap {
  max-width: 640px;
  margin: 8vh auto;
  padding: 0 24px;
  font-family: system-ui, sans-serif;
}
h1 {
  margin-bottom: 4px;
}
h1 small {
  color: #888;
  font-size: 0.5em;
}
.lead {
  color: #555;
  margin-top: 0;
}
button {
  padding: 10px 20px;
  font-size: 1rem;
  border: none;
  border-radius: 999px;
  background: #078017;
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.result {
  margin-top: 20px;
  padding: 12px 16px;
  border-radius: 8px;
}
.result.ok {
  background: #e8f5e9;
  color: #1b5e20;
}
.result.error {
  background: #fdecea;
  color: #b71c1c;
  white-space: pre-wrap;
}
.result.idle {
  color: #888;
}
</style>
