<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { DEFAULT_TEXT_REGEX } from '@/api/userApi'
import JobListPanel from '@/components/JobListPanel.vue'
import ResultExplorer from '@/components/ResultExplorer.vue'
import { useProcessImage } from '@/composables/useProcessImage'
import { useLicenseStatusAdapter } from '@/composables/useLicenseStatusAdapter'

const {
  phase,
  errorMessage,
  job,
  jobStatus,
  uploadedFiles,
  submit,
} = useProcessImage()

const { indicator: licenseIndicator, isChecking: isLicenseChecking, refreshLicenseStatus, expiryInfo, expiryTone } =
  useLicenseStatusAdapter()

const selectedFiles = ref<File[]>([])
const activeTab = ref<'upload' | 'result' | 'jobs'>('upload')
const showQuickMenu = ref(false)
const licenseKey = ref('')
const isActivatingLicense = ref(false)
const licenseFeedback = ref<{ tone: 'success' | 'error'; message: string } | null>(null)
const isLicenseEditing = ref(false)

const ACTIVE_TAB_STORAGE_KEY = 'masky-vue-active-tab'

function formatExpiryDisplay(): string {
  if (!expiryInfo.value.expiryDate || expiryInfo.value.daysRemaining === null) {
    return '（未設定）'
  }
  const date = new Date(expiryInfo.value.expiryDate)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  const days = expiryInfo.value.daysRemaining
  return `${year}年${month}月${day}日（残り${days}日）`
}

function getReadableErrorMessage(errorId?: string, originalMessage?: string): string {
  // バックエンドのエラーIDに基づいて、ユーザーフレンドリーなメッセージに翻訳
  const errorMap: Record<string, string> = {
    'invalid_serial_number': 'ライセンスキーの形式が正しくありません。入力内容を確認してください。',
    'licence_has_expired': 'このライセンスキーの有効期限が切れています。新しいキーを登録してください。',
    'licence_not_found': 'このライセンスキーは見つかりません。入力内容を確認してください。',
  }

  if (errorId && errorMap[errorId]) {
    return errorMap[errorId]
  }

  // マップにないエラーの場合は、元のメッセージを日本語化するか、汎用メッセージを返す
  if (originalMessage?.includes('expired')) {
    return 'ライセンスの有効期限が切れています。新しいキーを登録してください。'
  }
  if (originalMessage?.includes('invalid')) {
    return 'ライセンスキーが正しくありません。確認してから再度入力してください。'
  }

  return 'ライセンスの認証に失敗しました。入力内容を確認してもう一度試してください。'
}

onMounted(() => {
  const savedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
  if (savedTab === 'upload' || savedTab === 'jobs') {
    activeTab.value = savedTab
  }
})

watch(activeTab, (newTab) => {
  localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, newTab)
})

const licenseColor = computed(() => {
  switch (licenseIndicator.value.tone) {
    case 'checking':
      return 'warning'
    case 'active':
      return 'success'
    case 'inactive':
      return 'error'
  }
})

async function activateLicense() {
  if (!licenseKey.value.trim()) return

  isActivatingLicense.value = true
  licenseFeedback.value = null

  try {
    // ライセンスキーの形式は「目:xyz123 文字:abc456」のような形式
    const response = await fetch('/api/update-key?target=all', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_key: licenseKey.value.trim() }),
    })

    if (response.ok) {
      // 成功時は {eyes: {message_id, message}, text: {message_id, message}} 形式
      const data = await response.json().catch(() => ({}))
      const messages = Object.values(data)
        .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { message?: string }).message : null))
        .filter((message): message is string => Boolean(message))
      licenseFeedback.value = {
        tone: 'success',
        message: messages.length > 0 ? messages.join(' / ') : 'ライセンスを認証しました。',
      }
      licenseKey.value = ''
      isLicenseEditing.value = false
      await refreshLicenseStatus()
    } else {
      const data = await response.json().catch(() => ({}))
      // エラー時は {"detail": {"error_id", "message", "target"}} 形式(FastAPI HTTPException準拠)
      const errorId = data.detail?.error_id
      const originalMessage = data.detail?.message
      licenseFeedback.value = {
        tone: 'error',
        message: getReadableErrorMessage(errorId, originalMessage),
      }
    }
  } catch (error) {
    licenseFeedback.value = {
      tone: 'error',
      message: 'ライセンスキーの入力に問題があります。ネットワーク接続を確認してからもう一度試してください。',
    }
  } finally {
    isActivatingLicense.value = false
  }
}

function cancelLicenseEdit() {
  licenseKey.value = ''
  isLicenseEditing.value = false
  licenseFeedback.value = null
}

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

// 文字列検知の正規表現。サーバー既定値を初期表示し、ユーザーが上書きできる。
const textRegex = ref(DEFAULT_TEXT_REGEX)
const regexValid = computed(() => {
  if (!detectText.value) return true
  if (!textRegex.value.trim()) return false
  try {
    new RegExp(textRegex.value)
    return true
  } catch {
    return false
  }
})

// KIE(Key Information Extraction)の対象情報リスト。「患者名」のような意味指定で
// 該当する値をマスキングする(glm-experimental、Gradio dev版と同じく改行区切り)。
// バックエンドには kie= の繰り返しクエリで届く(ocrmask/workspace/endpoints.py の kie: list[str])。
// 現状の user-api(main) は未対応のため、送信しても無視されるだけで害はない。
const kieKeysInput = ref('')
const kieKeys = computed(() =>
  kieKeysInput.value
    .split('\n')
    .map((key) => key.trim())
    .filter((key) => key.length > 0),
)

const isBusy = computed(() => phase.value === 'uploading' || phase.value === 'polling')
const canSubmit = computed(
  () => selectedFiles.value.length > 0 && hasTargetSelected.value && regexValid.value && !isBusy.value,
)

const jobListPanel = ref<InstanceType<typeof JobListPanel> | null>(null)

async function onSubmit() {
  if (selectedFiles.value.length === 0 || !hasTargetSelected.value || !regexValid.value) return
  await submit(selectedFiles.value, {
    targets: { face: detectFace.value, text: detectText.value },
    regex: textRegex.value,
    kieKeys: kieKeys.value,
  })
}

// ジョブ登録・完了のタイミングで一覧も追従させる
watch(phase, (value) => {
  if (value === 'polling' || value === 'completed' || value === 'failed') {
    void jobListPanel.value?.refresh()
  }
  // 処理完了または失敗時に結果表示タブに自動遷移
  if (value === 'completed' || value === 'failed') {
    activeTab.value = 'result'
  }
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
      <div class="mk-header__controls">
        <div
          class="mk-status"
          :class="`mk-status--${licenseIndicator.tone}`"
          :title="licenseIndicator.title"
        >
          <span class="mk-status__dot" aria-hidden="true" />
          <span class="mk-status__text">ライセンス {{ licenseIndicator.label }}</span>
        </div>
        <v-btn
          icon="mdi-menu"
          variant="text"
          color="white"
          @click="showQuickMenu = !showQuickMenu"
        />
      </div>
    </header>

    <v-main class="mk-main">
      <v-container class="mk-container">
        <v-card class="mk-surface" rounded="0">
          <v-tabs v-model="activeTab" bg-color="surface" class="tabs-header">
            <v-tab value="upload" text="アップロード" />
            <v-tab value="result" text="結果表示" />
            <v-tab value="jobs" text="ジョブ管理" />
          </v-tabs>

          <v-card-text class="tabs-content">
            <!-- タブ1: アップロード -->
            <div v-show="activeTab === 'upload'" class="panel">
              <p class="mk-muted panel__lead">画像内の目・文字列を検知してマスキングします</p>

              <v-file-input
                :model-value="selectedFiles"
                label="ファイルを選択（PNG / JPG / GIF / WEBP / BMP / TIF / PDF / PPTX / DOCX / XLSX / ZIP）"
                accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.pdf,.pptx,.docx,.xlsx,.zip"
                prepend-icon="mdi-image-outline"
                density="comfortable"
                show-size
                multiple
                counter
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
            </div>

            <!-- タブ2: 結果表示 -->
            <div v-show="activeTab === 'result'" class="result-tab">
              <p class="panel__status" :class="statusToneClass">
                <v-icon :icon="statusIcon" size="20" />
                {{ statusLabel }}
              </p>

              <p v-if="phase === 'failed' || phase === 'error'" class="panel__result panel__result--error">
                {{ errorMessage }}
              </p>

              <div v-if="phase === 'completed' && jobStatus && job" class="panel__result-block">
                <ResultExplorer
                  :job-status="jobStatus"
                  :token="job.token"
                  :uploaded-files="uploadedFiles"
                />
              </div>

              <p v-if="phase === 'idle'" class="mk-muted" style="text-align: center; padding: 2rem 0;">
                処理結果がここに表示されます
              </p>
            </div>

            <!-- タブ3: ジョブ管理 -->
            <div v-show="activeTab === 'jobs'" class="jobs-tab">
              <JobListPanel ref="jobListPanel" />
            </div>
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>

    <footer class="mk-footer">
      <p class="mk-footer__copy">Copylight © INFORMATION DEVELOPMENT CO., LTD. All rights reserved.</p>
    </footer>

    <!-- クイックメニュー（右ドロワー） -->
    <v-navigation-drawer
      v-model="showQuickMenu"
      temporary
      location="right"
      width="360"
      class="quick-menu"
    >
      <v-card-text class="quick-menu__content">
        <p class="mk-section-title">設定</p>
        <v-divider class="my-3" />

        <!-- ライセンス セクション -->
        <div class="quick-menu__section">
          <p class="mk-label">ライセンス</p>
          <v-chip
            :color="licenseColor"
            :text="licenseIndicator.label"
            size="small"
            :loading="isLicenseChecking"
            class="quick-menu__chip"
          />
          <p class="mk-label">期限</p>
          <v-chip
            :color="expiryTone"
            :text="formatExpiryDisplay()"
            size="small"
            class="quick-menu__chip"
          />

          <div v-if="!isLicenseEditing" class="quick-menu__license-view">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              block
              @click="isLicenseEditing = true"
            >
              <v-icon icon="mdi-plus" start size="small" />
              ライセンス追加
            </v-btn>
            <v-btn
              color="secondary"
              variant="outlined"
              size="small"
              block
              class="mt-2"
              @click="refreshLicenseStatus"
            >
              <v-icon icon="mdi-refresh" start size="small" />
              再確認
            </v-btn>
          </div>

          <div v-else class="quick-menu__license-edit">
            <p class="quick-menu__field-label">ライセンスキー</p>
            <v-text-field
              v-model="licenseKey"
              placeholder="ライセンスキーを入力"
              density="comfortable"
              :disabled="isActivatingLicense"
              outlined
              hide-details
              class="mb-2"
            />
            <p class="quick-menu__field-hint">
              ライセンスキーを入力して認証してください。
            </p>

            <v-alert
              v-if="licenseFeedback"
              :color="licenseFeedback.tone === 'success' ? 'success' : 'error'"
              variant="tonal"
              closable
              class="mt-3 mb-3"
              @click:close="licenseFeedback = null"
            >
              {{ licenseFeedback.message }}
            </v-alert>

            <div class="quick-menu__button-group">
              <v-btn
                color="secondary"
                variant="outlined"
                size="small"
                block
                :disabled="isActivatingLicense"
                @click="cancelLicenseEdit"
              >
                キャンセル
              </v-btn>
              <v-btn
                color="primary"
                variant="flat"
                size="small"
                block
                :loading="isActivatingLicense"
                :disabled="!licenseKey.trim()"
                @click="activateLicense"
              >
                認証
              </v-btn>
            </div>
          </div>
        </div>

        <v-divider class="my-4" />

        <!-- 正規表現パターン セクション -->
        <div class="quick-menu__section">
          <p class="mk-label">正規表現パターン</p>
          <v-text-field
            v-model="textRegex"
            label="文字列検知用"
            density="comfortable"
            :disabled="isBusy"
            :error="!regexValid"
            :error-messages="regexValid ? [] : ['有効な正規表現を入力してください']"
            hint="例: \\d{2,10} は数字2〜10桁"
            persistent-hint
          />

          <div class="quick-menu__patterns">
            <v-chip
              label
              color="primary"
              variant="outlined"
              class="quick-menu__pattern-chip"
              @click="textRegex = '\\\\d{10}'"
            >
              10桁の数字
            </v-chip>
          </div>

          <v-textarea
            v-model="kieKeysInput"
            label="検知対象情報（任意）"
            density="comfortable"
            rows="3"
            :disabled="isBusy"
            placeholder="患者名&#10;生年月日&#10;住所"
            prepend-inner-icon="mdi-key-outline"
          />
        </div>

        <v-divider class="my-4" />

        <!-- 情報 セクション -->
        <div class="quick-menu__section">
          <p class="mk-label">情報</p>
          <p class="quick-menu__info-text">
            <strong>Masky v1.0</strong>
          </p>
        </div>
      </v-card-text>
    </v-navigation-drawer>
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
  justify-content: space-between;
  align-items: center;
}

.mk-header__brand {
  margin: 0;
  color: #ffffff;
  font-size: clamp(1.75rem, 2vw, 2.2rem);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mk-header__controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

/* Masky 本家(shell__status)のライセンス状態インジケーター。ヘッダーの primary 背景上での視認性を優先し、
   淡黄の --mk-warning ではなく専用トークンで表現する。 */
.mk-status {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 40px;
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: var(--mk-rounded-pill);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  backdrop-filter: blur(8px);
}

.mk-status__dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.08);
}

.mk-status__text {
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.mk-status--active {
  color: var(--mk-status-active-text);
  border-width: 2px;
  border-color: var(--mk-status-active-border);
  background: var(--mk-status-active-bg);
}

.mk-status--inactive {
  color: var(--mk-warning);
  border-width: 2px;
  border-color: var(--mk-warning-border);
  background: var(--mk-warning-surface);
}

.mk-status--checking {
  color: var(--mk-status-checking-text);
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
  max-width: 100%;
  padding-top: 6vh;
}

.tabs-header {
  border-bottom: 1px solid var(--mk-border);
}

.tabs-content {
  padding: 1.35rem;
  min-height: 600px;
}

.panel {
  padding: 0;
}

.jobs-tab {
  padding: 0;
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

.job-list-section {
  margin-top: 1.5rem;
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

.quick-menu {
  background: var(--mk-background);
}

.quick-menu__section {
  display: grid;
  gap: 0.75rem;
}

.mk-label {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--mk-text);
}

.quick-menu__info-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

.mk-section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--mk-text);
}

.quick-menu__content {
  padding-top: 1rem;
  overflow-y: auto;
  max-height: 100vh;
}

.quick-menu__license-view,
.quick-menu__license-edit {
  display: grid;
  gap: 0.75rem;
}

.quick-menu__field-label {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--mk-text);
}

.quick-menu__field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--mk-muted);
  line-height: 1.4;
}

.quick-menu__button-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 1rem;
}

.quick-menu__info-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

.quick-menu__section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.quick-menu__chip {
  width: fit-content !important;
  max-width: 100%;
}

.quick-menu__patterns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.quick-menu__pattern-chip {
  cursor: pointer;
}
</style>
