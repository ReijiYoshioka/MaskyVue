<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import JobListPanel from '@/components/JobListPanel.vue'
import TaskResultsBrowser from '@/components/TaskResultsBrowser.vue'
import SettingsPage from '@/components/SettingsPage.vue'
import { useProcessImage } from '@/composables/useProcessImage'
import { useLicenseStatusAdapter } from '@/composables/useLicenseStatusAdapter'
import { useRegexPatterns } from '@/composables/useRegexPatterns'
import { useToast } from '@/composables/useToast'
import { fileKind, FILE_KIND_ICONS, fileTypeLabel } from '@/utils/fileKind'

const { phase, submit, errorMessage } = useProcessImage()
const toast = useToast()

const { indicator: licenseIndicator, expiryInfo } = useLicenseStatusAdapter()

const selectedFiles = ref<File[]>([])
const activeTab = ref<'upload' | 'result' | 'jobs' | 'settings'>('upload')

const ACTIVE_TAB_STORAGE_KEY = 'masky-vue-active-tab'
const PROCESSING_MODE_STORAGE_KEY = 'masky-vue-processing-mode'
const DETECT_FACE_STORAGE_KEY = 'masky-vue-detect-face'
const DETECT_TEXT_STORAGE_KEY = 'masky-vue-detect-text'

onMounted(() => {
  ensureRegexPatternsLoaded()

  const savedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
  if (savedTab === 'upload' || savedTab === 'jobs' || savedTab === 'result' || savedTab === 'settings') {
    activeTab.value = savedTab
  }

  // リロードごとに毎回選び直す手間を避けるため、処理内容・チェック対象は
  // ブラウザに保存して次回も同じ設定を引き継ぐ(要望: リセットボタンは不要)。
  const savedProcessingMode = localStorage.getItem(PROCESSING_MODE_STORAGE_KEY)
  if (savedProcessingMode === 'check' || savedProcessingMode === 'mask') {
    processingMode.value = savedProcessingMode
  }
  const savedDetectFace = localStorage.getItem(DETECT_FACE_STORAGE_KEY)
  if (savedDetectFace !== null) detectFace.value = savedDetectFace === 'true'
  const savedDetectText = localStorage.getItem(DETECT_TEXT_STORAGE_KEY)
  if (savedDetectText !== null) detectText.value = savedDetectText === 'true'

  // 共有URL(?job=...&token=...)を直接開いた場合、そのタスク詳細を即表示する
  const params = new URLSearchParams(location.search)
  const sharedJobId = params.get('job')
  if (sharedJobId) {
    const sharedToken = params.get('token') ?? undefined
    activeTab.value = 'result'
    void taskResultsBrowser.value?.openTaskById(sharedJobId, sharedToken)
    history.replaceState(null, '', location.pathname + location.hash)
  }
})

watch(activeTab, (newTab) => {
  localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, newTab)
})

function formatExpiryDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function onFilesUpdate(value: File[] | File | null) {
  if (!value) {
    selectedFiles.value = []
  } else if (Array.isArray(value)) {
    selectedFiles.value = value
  } else {
    selectedFiles.value = [value]
  }
  if (selectedFiles.value.length > 0) {
    toast.success(`${selectedFiles.value.length}件のファイルを追加しました`)
  }
}

function removeSelectedFile(index: number) {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== index)
}

function clearSelectedFiles() {
  selectedFiles.value = []
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

const totalSelectedSize = computed(() => selectedFiles.value.reduce((sum, f) => sum + f.size, 0))

// UI/UX要件2.3: 「チェックのみ」か「チェック＋マスク」かをタスク登録時に選ぶ。
// バックエンドは face_check/face_mask, text_check/text_mask を個別指定できるため、
// マスクまで行うかどうかは対象(目/文字)の check/mask フラグを揃えて切り替える。
const processingMode = ref<'check' | 'mask'>('mask')
const shouldMask = computed(() => processingMode.value === 'mask')

const detectFace = ref(true)
const detectText = ref(true)
const hasTargetSelected = computed(() => detectFace.value || detectText.value)

watch(processingMode, (value) => {
  localStorage.setItem(PROCESSING_MODE_STORAGE_KEY, value)
})
watch(detectFace, (value) => {
  localStorage.setItem(DETECT_FACE_STORAGE_KEY, String(value))
})
watch(detectText, (value) => {
  localStorage.setItem(DETECT_TEXT_STORAGE_KEY, String(value))
})
const targetSummaryLabel = computed(() => {
  const labels = [detectFace.value ? '目' : '', detectText.value ? '文字' : ''].filter(Boolean)
  return labels.length > 0 ? labels.join('・') : '未選択'
})
const processingModeLabel = computed(() => (shouldMask.value ? 'チェック＋マスク' : 'チェックのみ'))

// 文字検知用の正規表現は、共通設定画面(SettingsPage.vue)で有効化したものをそのまま使う
// (有効状態はこのブラウザのローカルに保存される)。このタスク登録画面側での再選択は行わない。
const { enabledPatterns: selectedRegexPatterns, ensureLoaded: ensureRegexPatternsLoaded } = useRegexPatterns()

const isBusy = computed(() => phase.value === 'uploading' || phase.value === 'polling')
const isLicenseInactive = computed(() => licenseIndicator.value.tone === 'inactive')
const canSubmit = computed(
  () =>
    selectedFiles.value.length > 0 &&
    hasTargetSelected.value &&
    !isBusy.value &&
    !isLicenseInactive.value,
)

const jobListPanel = ref<InstanceType<typeof JobListPanel> | null>(null)
const taskResultsBrowser = ref<InstanceType<typeof TaskResultsBrowser> | null>(null)

// 作業キューの「結果を開く」から処理結果タブへ遷移し、該当タスクを直接開く。
async function onOpenResult(jobId: string) {
  activeTab.value = 'result'
  await taskResultsBrowser.value?.openTaskById(jobId)
}

// ヘッダー共通の「共有URLを開く」(index-03.html の open-token-url に相当)。
// 共有URL(?job=...&token=...)またはタスクIDそのものを貼り付けて開けるようにする。
const shareUrlDialogOpen = ref(false)
const shareUrlInput = ref('')
const shareUrlError = ref('')

function openSharedUrlDialog() {
  shareUrlInput.value = ''
  shareUrlError.value = ''
  shareUrlDialogOpen.value = true
}

/** 貼り付けられた値から job_id と token(あれば)を取り出す。URL全体でもID単体でも受け付ける。 */
function parseSharedUrlInput(value: string): { jobId: string; token: string | null } | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const jobId = url.searchParams.get('job')
    if (jobId) return { jobId, token: url.searchParams.get('token') }
  } catch {
    // URLとして解釈できない場合は、タスクIDそのものが貼られたとみなす
  }
  return { jobId: trimmed, token: null }
}

async function submitSharedUrl() {
  const parsed = parseSharedUrlInput(shareUrlInput.value)
  if (!parsed) {
    shareUrlError.value = '共有URLまたはタスクIDを入力してください。'
    return
  }
  shareUrlError.value = ''
  shareUrlDialogOpen.value = false
  activeTab.value = 'result'
  await taskResultsBrowser.value?.openTaskById(parsed.jobId, parsed.token ?? undefined)
}

async function onSubmit() {
  if (selectedFiles.value.length === 0 || !hasTargetSelected.value) return
  await submit(selectedFiles.value, {
    targets: { face: detectFace.value, text: detectText.value },
    shouldMask: shouldMask.value,
    regexPatterns: selectedRegexPatterns.value,
  })
}

watch(phase, (value) => {
  if (value === 'polling') {
    toast.success('タスクを登録しました', 'キューに追加され、順次処理されます')
  }
  if (value === 'polling' || value === 'completed' || value === 'failed') {
    void jobListPanel.value?.refresh()
  }
  if (value === 'completed' || value === 'failed') {
    activeTab.value = 'result'
    void taskResultsBrowser.value?.refreshList()
  }
  if (value === 'error') {
    toast.error('タスクの登録に失敗しました', errorMessage.value)
  }
})
</script>

<template>
  <v-app>
  <div class="app-shell">
    <!-- サイドバー -->
    <aside class="sidebar" aria-label="メインナビゲーション">
      <a class="brand" href="#" aria-label="Masky ホーム">
        <span class="brand-mark">
          <svg viewBox="0 0 24 24" width="27" height="27">
            <path d="M3.2 9.1c2.5-2 5.3-3 8.8-3s6.3 1 8.8 3l-1.1 6.2c-.2 1.2-1.3 2.1-2.5 2.1h-2.4c-1 0-1.9-.6-2.3-1.5L12 14.7l-.5 1.2c-.4.9-1.3 1.5-2.3 1.5H6.8c-1.2 0-2.3-.9-2.5-2.1L3.2 9.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <path d="M5 10.2c1.9-.8 4-.9 6.3-.2M19 10.2c-1.9-.8-4-.9-6.3-.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </span>
        <span class="brand-name">
          <strong>Masky</strong>
          <span>Privacy image checker</span>
        </span>
      </a>

      <nav class="nav">
        <a class="nav-item" :class="{ active: activeTab === 'upload' }" href="#" @click.prevent="activeTab = 'upload'">
          <v-icon icon="mdi-plus" size="18" />
          <span>新しいタスク</span>
        </a>
        <a class="nav-item" :class="{ active: activeTab === 'jobs' }" href="#" @click.prevent="activeTab = 'jobs'">
          <v-icon icon="mdi-list-box" size="18" />
          <span>作業キュー</span>
        </a>
        <a
          class="nav-item"
          :class="{ active: activeTab === 'result' }"
          href="#"
          @click.prevent="activeTab = 'result'; taskResultsBrowser?.backToList()"
        >
          <v-icon icon="mdi-file-document-outline" size="18" />
          <span>処理結果</span>
        </a>

        <div class="nav-gap" />

        <a class="nav-item" :class="{ active: activeTab === 'settings' }" href="#" @click.prevent="activeTab = 'settings'">
          <v-icon icon="mdi-cog" size="18" />
          <span>共通設定</span>
        </a>
      </nav>

      <div class="nav-hint">タスクの追加は「新しいタスク」から行います。</div>

      <div class="sidebar-spacer" />

      <div class="worker-card" aria-label="AIワーカー状態">
        <div class="worker-row">
          <span class="status-dot" />
          <span>AIワーカー稼働中</span>
        </div>
        <div class="worker-meta">同時処理は常に1タスク</div>
      </div>

      <div class="sidebar-footnote">
        オンプレミス環境 · ログイン不要<br />
        すべてのタスクは private
      </div>
    </aside>

    <!-- メインコンテンツエリア -->
    <section class="workspace">
      <!-- ライセンスバナー -->
      <div v-if="licenseIndicator.tone === 'inactive'" class="license-banner">
        <div class="banner-main">
          <v-icon icon="mdi-alert-circle" class="icon" />
          <span>
            ライセンスが未認証です。
            <a href="#" @click.prevent="activeTab = 'settings'">共通設定</a>
            で登録してください。
          </span>
        </div>
      </div>
      <div v-else-if="expiryInfo.daysRemaining !== null && expiryInfo.daysRemaining < 30" class="license-banner">
        <div class="banner-main">
          <v-icon icon="mdi-alert-circle" class="icon" />
          <span>
            ライセンスの有効期限まで {{ expiryInfo.daysRemaining }}日 です（{{ formatExpiryDate(expiryInfo.expiryDate) }}まで）。
            継続利用には更新キーを登録してください。
          </span>
        </div>
        <a href="#" @click.prevent="activeTab = 'settings'">設定を開く</a>
      </div>

      <!-- トップバー -->
      <header class="topbar">
        <div class="page-heading">
          <h1>
            {{
              activeTab === 'upload' ? '新しいタスク'
              : activeTab === 'jobs' ? '作業キュー'
              : activeTab === 'settings' ? '共通設定'
              : (taskResultsBrowser?.pageHeaderTitle ?? '処理結果')
            }}
          </h1>
          <p v-if="activeTab === 'upload'">ファイルを登録すると、個人情報の自動チェックがキューで実行されます</p>
          <p v-else-if="activeTab === 'result'">{{ taskResultsBrowser?.pageHeaderSubtitle }}</p>
        </div>
        <div class="topbar-actions">
          <div class="environment-pill">
            <v-icon icon="mdi-server" size="16" />
            オンプレミス
          </div>
          <button class="btn outline small" @click="openSharedUrlDialog">
            <v-icon icon="mdi-link-variant" size="16" />
            共有URLを開く
          </button>
        </div>
      </header>

      <!-- メインコンテンツ -->
      <main>
        <!-- アップロードタブ -->
        <div v-show="activeTab === 'upload'" class="content">
          <div class="page-intro">
            <div>
              <h2>個人情報を自動チェック</h2>
              <p>ファイルをまとめて1つのタスクとして登録します。ZIPは再帰的に展開し、PDF・Officeファイルは内部画像を抽出して処理します。</p>
            </div>
          </div>

          <div class="grid task-builder-grid">
            <!-- 1. ファイルを追加 -->
            <section class="card">
              <div class="card-header">
                <div class="card-title">
                  <h3>1. ファイルを追加</h3>
                  <p>画像・ZIP・PDF・Officeファイルをまとめて登録できます</p>
                </div>
                <button v-if="selectedFiles.length" class="btn ghost small" @click="clearSelectedFiles">
                  すべて削除
                </button>
              </div>
              <div class="card-body">
                <label class="dropzone" :class="{ 'dropzone--disabled': isBusy }">
                  <input
                    type="file"
                    hidden
                    multiple
                    accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.pdf,.pptx,.docx,.xlsx,.zip"
                    :disabled="isBusy"
                    @change="onFilesUpdate(($event.target as HTMLInputElement).files ? Array.from(($event.target as HTMLInputElement).files!) : null)"
                  />
                  <div>
                    <div class="drop-icon">
                      <v-icon icon="mdi-tray-arrow-up" size="28" />
                    </div>
                    <h3>ここにファイルをドラッグ＆ドロップ</h3>
                    <p>またはクリックしてファイルを選択（複数まとめて登録できます）</p>
                    <div class="supported">
                      <span class="chip">画像</span>
                      <span class="chip">ZIP</span>
                      <span class="chip">PDF</span>
                      <span class="chip">PPTX</span>
                      <span class="chip">DOCX</span>
                      <span class="chip">XLSX</span>
                    </div>
                  </div>
                </label>

                <div v-if="selectedFiles.length" class="mt-16">
                  <div class="row between">
                    <strong>追加したファイル（{{ selectedFiles.length }}件）</strong>
                    <span class="mk-muted" style="font-size: 13px">合計 {{ formatFileSize(totalSelectedSize) }}</span>
                  </div>
                  <div class="file-list mt-8">
                    <div v-for="(file, index) in selectedFiles" :key="`${file.name}-${index}`" class="upload-file">
                      <div class="file-icon" :class="fileKind(file.name)">
                        <v-icon :icon="FILE_KIND_ICONS[fileKind(file.name)]" size="20" />
                      </div>
                      <div class="min-w-0">
                        <div class="file-name" :title="file.name">{{ file.name }}</div>
                        <div class="file-meta">{{ fileTypeLabel(file.name) }} · {{ formatFileSize(file.size) }}</div>
                      </div>
                      <button class="icon-btn" :disabled="isBusy" @click="removeSelectedFile(index)">
                        <v-icon icon="mdi-close" size="18" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- 2. 処理内容を選ぶ -->
            <aside class="task-config-sticky">
              <section class="card task-config-card">
                <div class="card-header">
                  <div class="card-title">
                    <h3>2. 処理内容を選ぶ</h3>
                    <p>不要なAI処理はOFFにできます</p>
                  </div>
                </div>
                <div class="card-body">
                  <div class="field">
                    <label>処理モード</label>
                    <div class="segmented" role="radiogroup" aria-label="処理モード">
                      <button
                        type="button"
                        class="segment"
                        :class="{ active: processingMode === 'check' }"
                        :disabled="isBusy"
                        @click="processingMode = 'check'"
                      >
                        チェックのみ
                      </button>
                      <button
                        type="button"
                        class="segment"
                        :class="{ active: processingMode === 'mask' }"
                        :disabled="isBusy"
                        @click="processingMode = 'mask'"
                      >
                        チェック＋マスク
                      </button>
                    </div>
                    <p class="field-help">
                      {{ shouldMask ? '検知した箇所を黒塗りし、Before / Afterを並べて確認できます。' : '検知結果のみ表示します。マスク画像は作成しません。' }}
                    </p>
                  </div>

                  <div class="field mt-16">
                    <label>チェック対象</label>
                    <div class="stack tight">
                      <button
                        type="button"
                        class="option-card"
                        :class="{ checked: detectFace }"
                        :disabled="isBusy"
                        @click="detectFace = !detectFace"
                      >
                        <span class="option-symbol"><v-icon icon="mdi-eye-outline" size="20" /></span>
                        <span class="grow">
                          <h4>顔写真の目</h4>
                          <p>顔検出AIで左右の目を検知</p>
                        </span>
                        <span class="switch" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="option-card"
                        :class="{ checked: detectText }"
                        :disabled="isBusy"
                        @click="detectText = !detectText"
                      >
                        <span class="option-symbol"><v-icon icon="mdi-format-text" size="20" /></span>
                        <span class="grow">
                          <h4>文字パターン</h4>
                          <p>OCR＋正規表現で照合</p>
                        </span>
                        <span class="switch" aria-hidden="true" />
                      </button>
                    </div>
                    <p v-if="!hasTargetSelected" class="validation-error">
                      <v-icon icon="mdi-alert-circle-outline" size="16" />
                      少なくとも1つのチェック対象を有効にしてください。
                    </p>

                  </div>
                </div>

                <div class="task-config-footer">
                  <div class="registration-summary" aria-label="登録内容の要約">
                    <div class="registration-summary-item">
                      <span>ファイル</span>
                      <strong>{{ selectedFiles.length ? `${selectedFiles.length}件` : '未追加' }}</strong>
                    </div>
                    <div class="registration-summary-item">
                      <span>処理</span>
                      <strong>{{ processingModeLabel }}</strong>
                    </div>
                    <div class="registration-summary-item">
                      <span>対象</span>
                      <strong>{{ targetSummaryLabel }}</strong>
                    </div>
                  </div>
                  <v-tooltip :disabled="!isLicenseInactive" location="top">
                    <template #activator="{ props: tooltipProps }">
                      <span v-bind="tooltipProps" class="d-block mt-16">
                        <v-btn
                          class="btn primary large block"
                          :disabled="!canSubmit"
                          :loading="isBusy"
                          @click="onSubmit"
                        >
                          <v-icon icon="mdi-tray-arrow-up" start size="18" />
                          タスクを登録する
                        </v-btn>
                      </span>
                    </template>
                    ライセンスを設定画面で登録してください。
                  </v-tooltip>
                  <div class="registration-guard" :class="{ ready: canSubmit }">
                    {{
                      canSubmit
                        ? `${selectedFiles.length}件のファイルをキューへ登録できます`
                        : isLicenseInactive
                          ? 'ライセンスを設定画面で登録してください。'
                          : selectedFiles.length
                            ? 'チェック対象を1つ以上選択してください。'
                            : '最初にファイルを追加してください。'
                    }}
                  </div>
                  <div class="compact-notes">
                    <div class="compact-note">
                      <v-icon icon="mdi-lock-outline" size="16" />
                      <span>タスクはprivate。操作・結果閲覧には発行トークンを使用します。</span>
                    </div>
                    <div class="compact-note">
                      <v-icon icon="mdi-clock-outline" size="16" />
                      <span>元ファイルと結果は保持期限を過ぎると削除されます。</span>
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>

        <!-- 結果表示タブ -->
        <div v-show="activeTab === 'result'">
          <TaskResultsBrowser ref="taskResultsBrowser" @open-jobs-tab="activeTab = 'jobs'" />
        </div>

        <!-- ジョブ管理タブ -->
        <div v-show="activeTab === 'jobs'" class="content wide">
          <JobListPanel ref="jobListPanel" @open-result="onOpenResult" />
        </div>

        <!-- 共通設定タブ -->
        <div v-show="activeTab === 'settings'" class="content wide">
          <SettingsPage />
        </div>
      </main>
    </section>
  </div>

  <!-- 共有URLから結果を開く(index-03.html の openSharedUrlModal に相当) -->
  <v-dialog v-model="shareUrlDialogOpen" max-width="480">
    <v-card rounded="lg">
      <v-card-title class="dialog-title">
        共有URLから結果を開く
        <div class="dialog-subtitle">ログインは不要です</div>
      </v-card-title>
      <v-card-text class="stack tight">
        <v-text-field
          v-model="shareUrlInput"
          label="共有URLまたはタスクID"
          placeholder="https://masky.local/?job=...&token=..."
          density="comfortable"
          autofocus
          :error="!!shareUrlError"
          :error-messages="shareUrlError ? [shareUrlError] : []"
          @keyup.enter="submitSharedUrl"
        />
        <div class="alert info">
          <v-icon icon="mdi-information-outline" size="18" />
          <div>共有URLには結果の閲覧・ダウンロード権限を持つトークンが含まれます。信頼できる相手から受け取ったURLのみ開いてください。</div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="outlined" @click="shareUrlDialogOpen = false">キャンセル</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!shareUrlInput.trim()" @click="submitSharedUrl">開く</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- トースト通知(index-03.html の #toast-root / toast() に相当) -->
  <div class="toast-root" aria-live="polite" aria-atomic="true">
    <!-- エラーは要点(title)だけを表示し、詳細(message)はライセンス未登録時の
         「タスクを登録する」ボタンと同じ v-tooltip でホバー時にだけ見せる。 -->
    <v-tooltip
      v-for="item in toast.items"
      :key="item.id"
      :disabled="item.type !== 'error' || !item.message"
      location="top"
    >
      <template #activator="{ props: tooltipProps }">
        <div
          v-bind="tooltipProps"
          class="toast"
          :class="{ error: item.type === 'error' }"
          @mouseenter="toast.pause(item.id)"
          @mouseleave="toast.resume(item.id)"
        >
          <v-icon :icon="item.type === 'error' ? 'mdi-alert-circle-outline' : 'mdi-check'" size="19" />
          <div class="toast-body">
            <strong :title="item.title">{{ item.title }}</strong>
            <span v-if="item.type !== 'error' && item.message" :title="item.message">{{ item.message }}</span>
          </div>
        </div>
      </template>
      {{ item.message }}
    </v-tooltip>
  </div>
  </v-app>
</template>

<style>
/* :root は <html> 要素を指すため scoped の data-v-xxxx 属性が付与されず、
   scoped ブロック内に置くと永久にマッチしない(変数が未定義になり grid-template-columns
   が丸ごと無効化されてサイドバー用の列が確保されない)。グローバルスタイルとして分離する。 */
:root {
  --bg: #f4f6fa;
  --surface: #ffffff;
  --surface-subtle: #f8fafc;
  --text: #1b2537;
  --text-soft: #5a6779;
  --text-faint: #8892a3;
  --line: #dde4ee;
  --line-strong: #c9d4e3;
  --primary: #3560d0;
  --primary-strong: #2549b6;
  --primary-soft: #e9efff;
  --success: #148055;
  --success-soft: #e4f6ee;
  --warning: #a96407;
  --warning-soft: #fff3dd;
  --danger: #c73f4b;
  --danger-soft: #ffeff0;
  --info: #24699e;
  --info-soft: #eaf4fc;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, .05), 0 2px 8px rgba(31, 48, 78, .05);
  --shadow-md: 0 10px 28px rgba(20, 34, 59, .12), 0 2px 8px rgba(20, 34, 59, .06);
  --shadow-lg: 0 24px 64px rgba(20, 34, 59, .20), 0 4px 16px rgba(20, 34, 59, .10);
  --radius: 12px;
  --radius-lg: 16px;
  --sidebar-w: 252px;
  --topbar-h: 74px;
  --focus: 0 0 0 3px rgba(53, 96, 208, .25);
}

* { box-sizing: border-box; }
a { color: inherit; text-decoration: none; }
</style>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar-w);
  z-index: 40;
  display: flex;
  flex-direction: column;
  padding: 24px 16px 20px;
  color: #dce6f5;
  background: linear-gradient(180deg, #0e1828 0%, #0b1422 100%);
  border-right: 1px solid rgba(255, 255, 255, .06);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 8px 24px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #6788f4, #3e63cf 60%, #20aa8d);
  color: #fff;
  box-shadow: 0 10px 25px rgba(51, 89, 205, .32);
}

.brand-name strong {
  display: block;
  font-size: 22px;
  letter-spacing: -.02em;
  color: #fff;
  line-height: 1.1;
}

.brand-name span {
  display: block;
  margin-top: 3px;
  color: #8fa0b9;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: none;
  white-space: nowrap;
}

.nav {
  display: grid;
  gap: 6px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 50px;
  padding: 12px 14px;
  border-radius: 11px;
  color: #aebbd0;
  font-weight: 700;
  font-size: 15px;
  transition: background .16s ease, color .16s ease;
  border: none;
  background: transparent;
  cursor: pointer;
  text-decoration: none;
}

.nav-item:hover {
  color: #fff;
  background: rgba(255, 255, 255, .07);
}

.nav-item.active {
  color: #fff;
  background: linear-gradient(90deg, rgba(87, 125, 231, .32), rgba(87, 125, 231, .10));
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: -16px;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #6f91fa;
}

.nav-gap {
  height: 22px;
}

.nav-hint {
  margin: 6px 14px 0;
  color: #6f829e;
  font-size: 11.5px;
  line-height: 1.6;
}

.sidebar-spacer {
  flex: 1;
}

.worker-card {
  margin: 12px 2px 0;
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, .055);
  border: 1px solid rgba(255, 255, 255, .07);
}

.worker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 700;
  color: #f4f7ff;
  font-size: 13.5px;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #35c69d;
  box-shadow: 0 0 0 4px rgba(53, 198, 157, .13);
}

.worker-meta {
  margin-top: 8px;
  color: #8fa0b9;
  font-size: 12px;
}

.sidebar-footnote {
  padding: 14px 6px 0;
  color: #687a94;
  font-size: 11px;
  line-height: 1.6;
}

.workspace {
  grid-column: 2;
  min-width: 0;
  min-height: 100vh;
}

.license-banner {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 28px;
  color: #714100;
  background: #fff0cf;
  border-bottom: 1px solid #efd49e;
  font-size: 13px;
  font-weight: 650;
}

.license-banner .banner-main {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.license-banner .icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.license-banner a {
  color: #7b4802;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}

.topbar {
  height: var(--topbar-h);
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 30px;
  background: rgba(248, 250, 253, .9);
  border-bottom: 1px solid rgba(207, 216, 229, .85);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.page-heading h1 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -.01em;
}

.page-heading p {
  margin: 3px 0 0;
  color: var(--text-soft);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.environment-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 99px;
  background: rgba(255, 255, 255, .75);
  color: var(--text-soft);
  font-size: 12.5px;
  font-weight: 700;
}

main {
  min-height: calc(100vh - var(--topbar-h) - 42px);
  padding: 30px;
}

main:focus {
  outline: none;
}

.content {
  width: min(1240px, 100%);
  margin: 0;
}

.content.wide {
  width: min(1420px, 100%);
}

.content.narrow {
  width: min(980px, 100%);
}

.page-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.page-intro h2 {
  margin: 0;
  font-size: 27px;
  line-height: 1.3;
  letter-spacing: -.03em;
}

.page-intro p {
  max-width: 720px;
  margin: 8px 0 0;
  color: var(--text-soft);
  font-size: 14.5px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.card-header {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
}

.card-title h3 {
  margin: 0;
  font-size: 16.5px;
  letter-spacing: -.01em;
}

.card-title p {
  margin: 3px 0 0;
  color: var(--text-soft);
  font-size: 12.5px;
}

.card-body {
  padding: 22px;
}

.grid {
  display: grid;
  gap: 20px;
}

.task-builder-grid {
  grid-template-columns: minmax(0, 1.55fr) minmax(340px, .85fr);
  align-items: start;
}

.task-config-sticky {
  position: sticky;
  top: calc(var(--topbar-h) + 18px);
}

.task-config-footer {
  padding: 18px 22px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface-subtle);
}

.stack {
  display: grid;
  gap: 18px;
}

.stack.tight {
  gap: 10px;
}

.dialog-title {
  display: block;
  padding: 20px 24px 4px;
}

.dialog-subtitle {
  margin-top: 4px;
  color: var(--text-soft);
  font-size: 12.5px;
  font-weight: 400;
}

.alert {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid;
  border-radius: 12px;
  font-size: 14px;
}

.alert.info {
  color: #275b83;
  background: #eaf4fc;
  border-color: #cde4f4;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row.between {
  justify-content: space-between;
}

.min-w-0 {
  min-width: 0;
}

.grow {
  flex: 1;
  min-width: 0;
}

/* ---------- dropzone / file list ---------- */
.dropzone {
  position: relative;
  min-height: 250px;
  padding: 30px;
  display: grid;
  place-items: center;
  text-align: center;
  border: 2px dashed var(--line-strong);
  border-radius: 16px;
  background: #fbfcfe;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease;
}

.dropzone:hover {
  border-color: var(--primary);
  background-color: #f6f8ff;
}

.dropzone--disabled {
  pointer-events: none;
  opacity: .6;
}

.drop-icon {
  width: 60px;
  height: 60px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: var(--primary);
  background: var(--primary-soft);
}

.dropzone h3 {
  margin: 0;
  font-size: 19px;
  letter-spacing: -.01em;
}

.dropzone p {
  margin: 8px 0 0;
  color: var(--text-soft);
  font-size: 13.5px;
}

.dropzone .supported {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  gap: 7px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 6px 12px;
  color: var(--text-soft);
  background: var(--surface-subtle);
  border: 1px solid var(--line);
  border-radius: 99px;
  font-size: 12.5px;
  font-weight: 700;
}

.file-list {
  display: grid;
  gap: 9px;
}

.upload-file {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 64px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #fff;
}

.file-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--primary);
  background: var(--primary-soft);
}

.file-icon.zip {
  color: #7b58b5;
  background: #f1eafa;
}

.file-icon.pdf {
  color: #c34d58;
  background: #fff0f1;
}

.file-icon.office {
  color: #2d78a5;
  background: #e9f5fb;
}

.file-icon.image {
  color: #16836a;
  background: #e4f7f2;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 14.5px;
}

.file-meta {
  margin-top: 2px;
  color: var(--text-faint);
  font-size: 12px;
}

.icon-btn {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--surface-subtle);
  color: var(--text);
}

.icon-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-soft);
}

.btn.ghost:hover {
  background: var(--surface-subtle);
  color: var(--text);
}

.btn.small {
  min-height: 35px;
  padding: 7px 12px;
  font-size: 13px;
  border-radius: 9px;
}

/* ---------- segmented / option-card / switch ---------- */
.field {
  display: grid;
  gap: 7px;
}

.field > label {
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 800;
}

.field-help {
  margin: 0;
  color: var(--text-faint);
  font-size: 12.5px;
  line-height: 1.55;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 5px;
  background: #edf1f7;
  border-radius: 12px;
}

.segment {
  min-height: 44px;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-soft);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}

.segment:disabled {
  opacity: .6;
  cursor: not-allowed;
}

.segment.active {
  color: var(--primary);
  background: #fff;
  box-shadow: 0 1px 4px rgba(27, 43, 70, .10);
}

.option-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  text-align: left;
}

.option-card:hover {
  border-color: #b9c8e2;
}

.option-card.checked {
  border-color: #9db3f0;
  background: #f8faff;
}

.option-card:disabled {
  opacity: .6;
  cursor: not-allowed;
}

.option-symbol {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 11px;
  color: var(--primary);
  background: var(--primary-soft);
}

.option-card h4 {
  margin: 0;
  font-size: 15px;
}

.option-card p {
  margin: 2px 0 0;
  color: var(--text-soft);
  font-size: 12.5px;
}

.switch {
  position: relative;
  width: 42px;
  height: 24px;
  margin-left: auto;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #cbd3df;
  transition: background .15s;
}

.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .18);
  transition: transform .15s;
}

.checked .switch {
  background: var(--primary);
}

.checked .switch::after {
  transform: translateX(18px);
}

.validation-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}

/* ---------- registration summary / footer ---------- */
.registration-summary {
  display: grid;
  gap: 6px;
  padding: 4px 13px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: #fff;
}

.registration-summary-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 6px 0;
}

.registration-summary-item:not(:last-child) {
  border-bottom: 1px solid var(--line);
}

.registration-summary-item span {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 700;
}

.registration-summary-item strong {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 14px;
  line-height: 1.3;
  overflow-wrap: break-word;
}

.registration-guard {
  min-height: 22px;
  margin-top: 8px;
  text-align: center;
  color: var(--text-soft);
  font-size: 12.5px;
}

.registration-guard.ready {
  color: var(--success);
}

.compact-notes {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.compact-note {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  color: var(--text-soft);
  font-size: 12.5px;
}

.mt-8 {
  margin-top: 8px;
}

.mt-16 {
  margin-top: 16px;
}

.btn.large {
  min-height: 50px;
  padding: 12px 20px;
  font-size: 15.5px;
  border-radius: 12px;
}

.btn.block {
  width: 100%;
}

@media (max-width: 1120px) {
  .task-builder-grid {
    grid-template-columns: 1fr;
  }
  .task-config-sticky {
    position: static;
  }
}

.panel__targets {
  display: flex;
  gap: 1rem;
}

.panel__status {
  display: flex;
  align-items: center;
  margin: 1.25rem 0 0;
}

.panel__status--success {
  color: var(--success);
}

.panel__status--error {
  color: var(--danger);
}

.panel__result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 1rem 1.05rem;
  border-radius: var(--radius);
  white-space: pre-wrap;
}

.panel__result--error {
  background: rgba(196, 71, 71, 0.08);
  color: var(--danger);
}

.panel__result-block {
  margin-top: 1.25rem;
  display: grid;
  gap: 0.75rem;
}

.quick-menu__content {
  padding-top: 1rem;
  overflow-y: auto;
  max-height: 100vh;
}

.quick-menu__section {
  display: grid;
  gap: 0.75rem;
}

.mk-label {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
}

.mk-section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.quick-menu__chip {
  width: fit-content !important;
  max-width: 100%;
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
  color: var(--text);
}

.quick-menu__field-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-soft);
  line-height: 1.4;
}

.quick-menu__button-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-top: 1rem;
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

.quick-menu__info-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
}

.mk-muted {
  color: var(--text-soft);
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  min-height: 42px;
  padding: 9px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
  user-select: none;
  white-space: nowrap;
  transition: transform .12s ease, box-shadow .15s ease, background .15s ease, border-color .15s ease;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.btn.primary {
  color: #fff;
  background: linear-gradient(180deg, #4169da, #3055c3);
  border-color: #3055c3;
  box-shadow: 0 5px 13px rgba(53, 96, 208, .22);
}

.btn.primary:hover:not(:disabled) {
  background: linear-gradient(180deg, #4b74e4, #365fcf);
}

.panel__target-warning {
  margin: 0 0 1rem;
  font-size: 0.85rem;
}

.mt-2 {
  margin-top: 0.5rem;
}

.mt-3 {
  margin-top: 0.75rem;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.mb-3 {
  margin-bottom: 0.75rem;
}

.mb-4 {
  margin-bottom: 1rem;
}

.my-3 {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

.my-4 {
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.toast-root {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 6000;
  display: grid;
  justify-items: end;
  gap: 9px;
  pointer-events: none;
}

.toast {
  width: 320px;
  max-width: calc(100vw - 44px);
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 15px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 12px;
  color: #f7f9fd;
  background: #172235;
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: toast-in .22s ease;
}

.toast .v-icon {
  margin-top: 1px;
  color: #7ee0c4;
  flex: 0 0 auto;
}

.toast.error .v-icon {
  color: #ff9fa8;
}

/* 長いメッセージで右下トーストが画面を占有しないよう1行に切り詰め、詳細はホバーのtitle属性で見せる。 */
.toast-body {
  min-width: 0;
}

.toast strong {
  display: block;
  overflow: hidden;
  font-size: 13.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.toast span {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: #b7c3d6;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: help;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
