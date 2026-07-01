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
  <v-app>
    <!-- DESIGN.md「Navigation」: ヘッダーは primary 色の帯、白抜き大文字ブランド名 -->
    <header class="mk-header">
      <p class="mk-header__brand">MASKY</p>
    </header>

    <v-main class="mk-main">
      <v-container class="mk-container">
        <v-card class="mk-surface health-card">
          <v-card-text>
            <p class="mk-muted health-card__lead">user-api 疎通確認</p>

            <v-btn
              class="mk-button"
              color="primary"
              variant="flat"
              block
              :loading="state === 'loading'"
              @click="checkHealth"
            >
              GET /api/ を叩く
            </v-btn>

            <p v-if="state === 'ok'" class="health-card__result health-card__result--success">
              <v-icon icon="mdi-check-circle" size="20" />
              接続成功: {{ detail }}
            </p>
            <p v-else-if="state === 'error'" class="health-card__result health-card__result--error">
              <v-icon icon="mdi-alert-circle" size="20" />
              失敗: {{ detail }}
            </p>
            <p v-else-if="state === 'idle'" class="mk-muted health-card__result">
              <v-icon icon="mdi-information-outline" size="20" />
              ボタンを押して疎通を確認してください。
            </p>
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>

    <footer class="mk-footer">
      <p class="mk-footer__copy">Copylight © INFORMATION DEVELOPMENT CO., LTD. All rights reserved.</p>
    </footer>
  </v-app>
</template>

<style scoped>
/* DESIGN.md「Layout」: ヘッダー/メイン/フッターの3段構成、ヘッダー・フッターは primary 色 */
.mk-header,
.mk-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mk-primary);
}

.mk-header {
  min-height: 88px;
  padding: 0 2rem;
  justify-content: flex-start;
}

.mk-header__brand {
  margin: 0;
  color: #ffffff;
  font-size: clamp(1.75rem, 2vw, 2.2rem);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mk-footer {
  min-height: 72px;
  padding: 0 1.5rem;
}

.mk-footer__copy {
  margin: 0;
  color: #ffffff;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-align: center;
}

.mk-main {
  background: var(--mk-background);
}

.mk-container {
  max-width: 640px;
  padding-top: 8vh;
}

.health-card {
  padding: 1.35rem;
}

.health-card__lead {
  margin: 0 0 1rem;
}

.health-card__result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.25rem;
  padding: 1rem 1.05rem;
  border-radius: var(--mk-rounded-md);
}

.health-card__result--success {
  background: rgba(47, 125, 74, 0.08);
  color: var(--mk-success);
}

.health-card__result--error {
  background: rgba(196, 71, 71, 0.08);
  color: var(--mk-error);
  white-space: pre-wrap;
}

/* DESIGN.md「Components > Button」: 44px以上、角丸14px、大文字化しない、太字、primaryは浮遊感のあるshadow */
.mk-button {
  min-height: 44px;
  border-radius: var(--mk-rounded-sm);
  text-transform: none;
  font-weight: 700;
  letter-spacing: 0.02em;
  box-shadow: 0 16px 30px rgba(0, 123, 167, 0.22);
}
</style>
