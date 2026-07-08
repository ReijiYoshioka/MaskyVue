<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProcessImage } from '@/composables/useProcessImage'
import { normalizeMetric } from '@/types/processJob'

const {
  phase,
  errorMessage,
  jobStatus,
  resultImageObjectUrl,
  resultDownloadName,
  submit,
  downloadResult,
} = useProcessImage()

const selectedFiles = ref<File[]>([])

// v-file-input の modelValue は File[] | File | null のいずれもあり得るため、
// v-model の型に頼らず明示的に File[] へ正規化する。
function onFilesUpdate(value: File[] | File | null) {
  if (!value) {
    selectedFiles.value = []
  } else if (Array.isArray(value)) {
    selectedFiles.value = value
  } else {
    selectedFiles.value = [value]
  }
}

// README「不正なファイルや一部失敗時の挙動」: 目・文字列のどちらか一方でも失敗すると
// マスキング画像自体が生成されない。片方のバックエンドが不調な間は対象を絞れるようにする。
const detectFace = ref(true)
const detectText = ref(true)
const hasTargetSelected = computed(() => detectFace.value || detectText.value)

const isBusy = computed(() => phase.value === 'uploading' || phase.value === 'polling')
const canSubmit = computed(
  () => selectedFiles.value.length > 0 && hasTargetSelected.value && !isBusy.value,
)

async function onSubmit() {
  const file = selectedFiles.value[0]
  if (!file || !hasTargetSelected.value) return
  await submit(file, { face: detectFace.value, text: detectText.value })
}

const resultFile = computed(() => jobStatus.value?.files[0] ?? null)
const detectedFaceCount = computed(() => normalizeMetric(resultFile.value?.detectedFaceCount ?? null))
const detectedTextCount = computed(() => normalizeMetric(resultFile.value?.detectedTextCount ?? null))

const FILE_ERROR_LABELS: Record<string, string> = {
  image_unreadable: '画像を読み込めませんでした。',
  face_failed: '目の検知/マスキングに失敗しました。',
  text_failed: '文字列の検知/マスキングに失敗しました。',
  both_failed: '目・文字列とも検知/マスキングに失敗しました。',
}
const fileErrorLabel = computed(() => {
  const code = resultFile.value?.error
  if (!code) return null
  return FILE_ERROR_LABELS[code] ?? `処理に失敗しました（${code}）`
})

const statusLabel = computed(() => {
  switch (phase.value) {
    case 'idle':
      return 'ファイルを選択してください'
    case 'uploading':
      return 'アップロード中...'
    case 'polling':
      return `処理中...（${jobStatus.value?.status ?? 'queued'}）`
    case 'completed':
      return '完了しました'
    case 'failed':
      return '処理に失敗しました'
    case 'error':
      return 'エラーが発生しました'
    default:
      return ''
  }
})

const statusIcon = computed(() => {
  switch (phase.value) {
    case 'completed':
      return 'mdi-check-circle'
    case 'failed':
    case 'error':
      return 'mdi-alert-circle'
    case 'uploading':
      return 'mdi-cloud-upload-outline'
    case 'polling':
      return 'mdi-timer-sand'
    default:
      return 'mdi-information-outline'
  }
})

const statusToneClass = computed(() => {
  switch (phase.value) {
    case 'completed':
      return 'panel__status--success'
    case 'failed':
    case 'error':
      return 'panel__status--error'
    default:
      return 'mk-muted'
  }
})
</script>

<template>
  <v-app>
    <header class="mk-header">
      <p class="mk-header__brand">MASKY</p>
    </header>

    <v-main class="mk-main">
      <v-container class="mk-container">
        <v-card class="mk-surface panel">
          <v-card-text>
            <p class="mk-muted panel__lead">画像内の目・文字列を検知してマスキングします</p>

            <v-file-input
              :model-value="selectedFiles"
              label="画像を選択"
              accept=".png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff"
              prepend-icon="mdi-image-outline"
              density="comfortable"
              show-size
              :disabled="isBusy"
              @update:model-value="onFilesUpdate"
            />

            <div class="panel__targets">
              <v-checkbox
                v-model="detectFace"
                label="目"
                density="compact"
                hide-details
                :disabled="isBusy"
              />
              <v-checkbox
                v-model="detectText"
                label="文字列"
                density="compact"
                hide-details
                :disabled="isBusy"
              />
            </div>
            <p v-if="!hasTargetSelected" class="panel__target-warning mk-muted">
              少なくとも1つの対象を選択してください。
            </p>

            <v-btn
              class="mk-button"
              color="primary"
              variant="flat"
              block
              :disabled="!canSubmit"
              :loading="isBusy"
              @click="onSubmit"
            >
              マスキングを実行
            </v-btn>

            <p class="panel__status" :class="statusToneClass">
              <v-icon :icon="statusIcon" size="20" />
              {{ statusLabel }}
            </p>

            <p v-if="phase === 'failed' || phase === 'error'" class="panel__result panel__result--error">
              {{ errorMessage }}
            </p>

            <!-- ジョブ自体は completed でも、個別ファイルが face_failed/text_failed 等で
                 マスキング画像が生成されない場合がある（README「不正なファイルや一部失敗時の挙動」参照） -->
            <p v-if="phase === 'completed' && fileErrorLabel" class="panel__result panel__result--warning">
              <v-icon icon="mdi-alert-outline" size="20" />
              {{ fileErrorLabel }}
            </p>

            <div v-if="phase === 'completed'" class="panel__result-block">
              <img
                v-if="resultImageObjectUrl"
                :src="resultImageObjectUrl"
                alt="マスキング結果"
                class="panel__result-image"
              />
              <p class="mk-muted panel__counts">
                目の検知数: {{ detectedFaceCount ?? '—' }} / 文字列の検知数: {{ detectedTextCount ?? '—' }}
              </p>
              <v-btn
                v-if="resultImageObjectUrl"
                class="mk-button"
                color="secondary"
                variant="outlined"
                @click="downloadResult"
              >
                <v-icon icon="mdi-download" start />
                ダウンロード（{{ resultDownloadName }}）
              </v-btn>
            </div>
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
  padding-top: 6vh;
}

.panel {
  padding: 1.35rem;
}

.panel__lead {
  margin: 0 0 1rem;
}

.panel__targets {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.panel__target-warning {
  margin: 0 0 1rem;
  font-size: 0.85rem;
}

.panel__status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1.25rem 0 0;
}

.panel__status--success {
  color: var(--mk-success);
}

.panel__status--error {
  color: var(--mk-error);
}

.panel__result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 1rem 1.05rem;
  border-radius: var(--mk-rounded-md);
  white-space: pre-wrap;
}

.panel__result--warning {
  background: var(--mk-warning-surface);
  color: var(--mk-warning-deep);
}

.panel__result--error {
  background: rgba(196, 71, 71, 0.08);
  color: var(--mk-error);
}

.panel__result-block {
  margin-top: 1.25rem;
  display: grid;
  gap: 0.75rem;
}

.panel__result-image {
  width: 100%;
  border-radius: var(--mk-rounded-md);
  border: 1px solid var(--mk-border);
}

.panel__counts {
  margin: 0;
}

/* DESIGN.md「Components > Button」: 44px以上、角丸14px、大文字化しない、太字、primaryは浮遊感のあるshadow */
.mk-button {
  min-height: 44px;
  border-radius: var(--mk-rounded-sm);
  text-transform: none;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.mk-button[class*='bg-primary'] {
  box-shadow: 0 16px 30px rgba(0, 123, 167, 0.22);
}
</style>
