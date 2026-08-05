<script setup lang="ts">
// 処理結果画面。上司提示モック(index-03.html)の「処理結果」に合わせて、
// タスク一覧(カード) → タスク詳細(hero-summary + 指標カード + タブ) の2段構成にする。
// タブ内の「ファイル一覧」より深い階層(画像グリッド・Before/After)は既存の ResultExplorer に委譲する。
import { computed, ref, type Ref } from 'vue'
import { fetchJobList, fetchJobStatusById, fetchGeneratedFileBlob } from '@/api/userApi'
import { getJobToken, rememberJobToken, buildShareUrl } from '@/state/jobTokenStore'
import { useToast } from '@/composables/useToast'
import { TERMINAL_STATUSES } from '@/types/processJob'
import type {
  GeneratedFileResource,
  JobListEntry,
  JobStatusResponse,
  ProcessedImageFileResult,
  ProcessJobStatus,
} from '@/types/processJob'
import ResultExplorer from '@/components/ResultExplorer.vue'
import FlowNav, { type FlowStep } from '@/components/FlowNav.vue'

const toast = useToast()

// モックの非完了タスク詳細にある「キューを確認」リンクに相当。作業キュータブへの遷移は親に委譲する。
const emit = defineEmits<{ 'open-jobs-tab': [] }>()

type View = 'list' | 'detail'
type TaskTab = 'files' | 'errors' | 'config'

const view = ref<View>('list')
const jobs = ref<JobListEntry[]>([])
const loading = ref(false)
const errorMessage = ref('')
const loadedOnce = ref(false)

// 一覧の検索・絞り込み(モックの renderResults 相当)。
type ResultFilter = 'all' | 'completed' | 'cancelled' | 'mask' | 'check'
const resultSearch = ref('')
const resultFilter = ref<ResultFilter>('all')

const RESULT_FILTER_OPTIONS: { value: ResultFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'mask', label: 'チェック＋マスク' },
  { value: 'check', label: 'チェックのみ' },
]

function entryDidMask(entry: JobListEntry): boolean {
  return Boolean(entry.executionParameters?.faceMask || entry.executionParameters?.textMask)
}

/** モックの「{受付日時} のタスク/チェック」に相当。人が読める題名フィールドがAPIに無いため、
 *  受付日時と処理モードから合成する。 */
function entryTitle(entry: JobListEntry): string {
  const suffix = entry.executionParameters ? (entryDidMask(entry) ? 'のタスク' : 'のチェック') : 'のタスク'
  return `${formatDateTime(entry.startDate)} ${suffix}`
}

const filteredJobs = computed(() => {
  let result = jobs.value
  if (resultFilter.value !== 'all') {
    result = result.filter((entry) => {
      if (resultFilter.value === 'completed') return entry.status === 'completed'
      if (resultFilter.value === 'cancelled') return entry.status === 'cancelled'
      if (resultFilter.value === 'mask') return entryDidMask(entry)
      if (resultFilter.value === 'check') return !entryDidMask(entry)
      return true
    })
  }
  const query = resultSearch.value.trim().toLowerCase()
  if (query) {
    result = result.filter((entry) => entry.jobId.toLowerCase().includes(query))
  }
  return result
})

const selectedJobId = ref<string | null>(null)
const selectedJobStatus = ref<JobStatusResponse | null>(null)
/** 一覧から遷移した場合のみ埋まる、登録日時(モックの「登録 {created}」相当。詳細APIには無い)。 */
const selectedStartDate = ref<string | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const taskTab = ref<TaskTab>('files')
const isBundleDownloading = ref(false)

// FlowNav(モックの flowNav に相当)。ResultExplorer の内部階層(files/images/detail)を
// 読み取って STEP2/STEP3 の表示に反映する。画像詳細(Before/After比較)はモックでも
// モーダル的な扱いで専用ステップを持たないため、STEP3(images)のまま扱う。
const resultExplorerRef = ref<InstanceType<typeof ResultExplorer> | null>(null)

const flowSteps = computed<FlowStep[]>(() => {
  const explorerLevel = resultExplorerRef.value?.level ?? 'files'
  const group = resultExplorerRef.value?.selectedGroup ?? null
  return [
    {
      label: 'STEP 1',
      title: 'タスクを選ぶ',
      value: selectedJobId.value ?? '一覧から選択',
      clickable: true,
    },
    {
      label: 'STEP 2',
      title: 'ファイルを選ぶ',
      value: explorerLevel === 'files' ? 'ファイル一覧を表示中' : (group?.uploadFileName ?? '—'),
      clickable: explorerLevel !== 'files',
    },
    {
      label: 'STEP 3',
      title: '画像を確認',
      value: explorerLevel === 'files' ? '—' : 'サムネイル → 比較表示',
      clickable: false,
    },
  ]
})

const flowCurrentStep = computed(() => (resultExplorerRef.value?.level === 'files' ? 2 : 3))

// モックの renderFileDetail は「タスク全体」ではなく「1つのアップロードファイル」を主語にした
// 専用画面で、hero-summary・メトリクス・タスクタブは表示されない。ResultExplorer が
// ファイル一覧より深い階層(images/detail)に入った時だけ同じ見せ方にする。
const isDrilledIntoFile = computed(
  () => taskTab.value === 'files' && resultExplorerRef.value !== null && resultExplorerRef.value.level !== 'files',
)

function onFlowStepClick(index: number) {
  if (index === 0) {
    backToList()
  } else if (index === 1) {
    resultExplorerRef.value?.backToFiles()
  }
}

// 一覧APIは検知件数を常に非公開(null)で返す(トークンを渡す仕組みがないため)。
// 自分のタスクはトークンを保持しているので、一覧取得後に詳細APIを個別に呼んで
// 正しい検知件数(画像数・目/文字の内訳)を補完する。他人のタスクはトークンが無いため非公開のまま。
const ownDetectionCounts = ref<Record<string, { count: number; faceCount: number; textCount: number }>>({})

const STATUS_LABELS: Record<ProcessJobStatus, string> = {
  queued: '待機中',
  running: '実行中',
  pausing: '一時停止中…',
  cancelling: 'キャンセル中…',
  paused: '一時停止',
  completed: '完了',
  failed: '失敗',
  cancelled: 'キャンセル済み',
}

/** モックの statusBadge() の色分け(index-03.html)に対応させる。 */
const STATUS_COLORS: Record<ProcessJobStatus, string> = {
  queued: 'badge-neutral',
  running: 'badge-primary',
  pausing: 'badge-warning',
  cancelling: 'badge-warning',
  paused: 'badge-neutral',
  completed: 'badge-success',
  failed: 'badge-danger',
  cancelled: 'badge-neutral',
}

function isOwnJob(jobId: string): boolean {
  return getJobToken(jobId) !== null
}

function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function refreshList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await fetchJobList()
    // 直近のジョブを先頭に(モックの「新しく完了したタスクを上に」と揃える)
    jobs.value = [...result.jobs].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    loadedOnce.value = true
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
  void loadOwnDetectionCounts()
}

/** 自分のタスク(トークン保持)だけ、詳細APIを個別に呼んで検知件数を補完する。
 *  一覧APIにはトークンを渡す仕組みが無いため、この追加取得でしか正しい件数を出せない。 */
async function loadOwnDetectionCounts() {
  const ownJobs = jobs.value.filter((entry) => isOwnJob(entry.jobId))
  await Promise.all(
    ownJobs.map(async (entry) => {
      const token = getJobToken(entry.jobId)
      if (!token) return
      try {
        const status = await fetchJobStatusById(entry.jobId, token)
        const count = status.files.filter(
          (f) => (f.detectedFaceCount ?? 0) > 0 || (f.detectedTextCount ?? 0) > 0,
        ).length
        const faceCount = status.files.reduce((sum, f) => sum + Math.max(0, f.detectedFaceCount ?? 0), 0)
        const textCount = status.files.reduce((sum, f) => sum + Math.max(0, f.detectedTextCount ?? 0), 0)
        ownDetectionCounts.value = { ...ownDetectionCounts.value, [entry.jobId]: { count, faceCount, textCount } }
      } catch {
        // 取得失敗時は非公開表示のままにする(一覧全体を止めない)
      }
    }),
  )
}

// 一覧APIは DETECTION_STATS_ARE_PRIVATE=True の場合、検知件数を常に null で返す
// (トークンを渡す仕組みが無いため)。自分のタスクは loadOwnDetectionCounts() で
// 補完した値を優先し、それが無ければ 0件と非公開を区別して null を返す。
function detectedCount(entry: JobListEntry): number | null {
  const own = ownDetectionCounts.value[entry.jobId]
  if (own !== undefined) return own.count
  if (!entry.detectionStats) return null
  return entry.detectionStats.detectedFaceCount + entry.detectionStats.detectedTextCount
}

/** モックの「目◯件・文字◯件」内訳(STEP2のヒーロー指標と同じ見せ方)に相当。
 *  一覧APIの detectionStats は自分のタスクでも常に非公開のため、この内訳は
 *  loadOwnDetectionCounts() で補完できた自分のタスクにしか出せない。 */
function detectedBreakdown(entry: JobListEntry): { faceCount: number; textCount: number } | null {
  const own = ownDetectionCounts.value[entry.jobId]
  return own ? { faceCount: own.faceCount, textCount: own.textCount } : null
}

/**
 * 一覧カードの「結果を見る」クリック。モックの open-result アクションに相当し、
 * 自分のタスクならそのまま詳細へ、他人のタスクは画面を切り替えずモーダルでトークンを求める
 * (showTaskUnlock)。共有URL/直接URLで開く場合の全画面ロック(renderLockedTask)とは別の入口。
 */
async function openTask(entry: JobListEntry) {
  if (!isOwnJob(entry.jobId)) {
    openUnlockDialog(entry)
    return
  }
  // 詳細APIには作成日時が無いため、一覧から遷移する場合のみ一覧側の値を引き継ぐ(モックの「登録 {created}」相当)。
  await openTaskById(entry.jobId, undefined, entry.startDate)
}

/**
 * ジョブ管理タブや共有URLなど、他コンポーネントから直接タスク詳細を開くための入口。
 * sharedToken を渡した場合(共有URLから開いた場合)は、まだ自分のトークンとして
 * 保持していなくても、そのトークンで直接解錠を試みる。
 * startDate は一覧経由で開く場合のみ渡される、モック相当の「登録日時」表示用。
 */
async function openTaskById(jobId: string, sharedToken?: string, startDate: string | null = null) {
  selectedStartDate.value = startDate
  selectedJobId.value = jobId
  selectedJobStatus.value = null
  detailError.value = ''
  isLocked.value = false
  taskTab.value = 'files'
  view.value = 'detail'

  if (isOwnJob(jobId)) {
    await loadTaskDetail(jobId)
    return
  }

  if (sharedToken) {
    try {
      selectedJobStatus.value = await fetchJobStatusById(jobId, sharedToken)
      rememberJobToken(jobId, sharedToken)
      return
    } catch {
      // トークンが無効な場合は通常の「保護されたタスク」画面にフォールバックする
    }
  }

  // トークンを持たないタスク(他人のタスク)は、要件2.6により中身を見られない。
  // 401 を生のエラーとして出さず、モックの「保護されたタスク」画面に相当する
  // 案内 + トークン入力を出す。
  isLocked.value = true
}

async function loadTaskDetail(jobId: string) {
  detailLoading.value = true
  detailError.value = ''
  try {
    selectedJobStatus.value = await fetchJobStatusById(jobId, getJobToken(jobId))
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : String(err)
  } finally {
    detailLoading.value = false
  }
}

const isLocked = ref(false)
const unlockTokenInput = ref('')
const unlockError = ref('')
const unlockVerifying = ref(false)

async function unlockTask() {
  const jobId = selectedJobId.value
  if (!jobId || !unlockTokenInput.value.trim()) return

  unlockVerifying.value = true
  unlockError.value = ''
  const candidate = unlockTokenInput.value.trim()
  try {
    selectedJobStatus.value = await fetchJobStatusById(jobId, candidate)
    rememberJobToken(jobId, candidate)
    isLocked.value = false
  } catch {
    unlockError.value = 'トークンが一致しません。'
  } finally {
    unlockVerifying.value = false
  }
}

// 一覧カードから他人のタスクを開こうとした時のモーダル(モックの showTaskUnlock に相当)。
// 全画面のロック表示(isLocked)とは別に、一覧の上にダイアログだけを重ねる。
const unlockDialogOpen = ref(false)
const unlockDialogEntry = ref<JobListEntry | null>(null)
const unlockDialogTokenInput = ref('')
const unlockDialogError = ref('')
const unlockDialogVerifying = ref(false)

function openUnlockDialog(entry: JobListEntry) {
  unlockDialogEntry.value = entry
  unlockDialogTokenInput.value = ''
  unlockDialogError.value = ''
  unlockDialogOpen.value = true
}

async function verifyUnlockDialogToken() {
  const entry = unlockDialogEntry.value
  if (!entry || !unlockDialogTokenInput.value.trim()) return

  unlockDialogVerifying.value = true
  unlockDialogError.value = ''
  const candidate = unlockDialogTokenInput.value.trim()
  try {
    // 副作用のない状態取得(GET)でトークンの正誤を確認する。誤りなら 401 で例外になる。
    await fetchJobStatusById(entry.jobId, candidate)
    rememberJobToken(entry.jobId, candidate)
    unlockDialogOpen.value = false
    await openTaskById(entry.jobId, undefined, entry.startDate)
  } catch {
    unlockDialogError.value = 'トークンが一致しません。'
  } finally {
    unlockDialogVerifying.value = false
  }
}

function backToList() {
  view.value = 'list'
  selectedJobId.value = null
  selectedJobStatus.value = null
  isLocked.value = false
}

const totalErrors = computed(
  () => selectedJobStatus.value?.files.filter((f) => f.errors.length > 0).length ?? 0,
)
const totalDetected = computed(
  () =>
    selectedJobStatus.value?.files.filter(
      (f) => (f.detectedFaceCount ?? 0) > 0 || (f.detectedTextCount ?? 0) > 0,
    ).length ?? 0,
)
const totalFaceCount = computed(() =>
  (selectedJobStatus.value?.files ?? []).reduce((sum, f) => sum + Math.max(0, f.detectedFaceCount ?? 0), 0),
)
const totalTextCount = computed(() =>
  (selectedJobStatus.value?.files ?? []).reduce((sum, f) => sum + Math.max(0, f.detectedTextCount ?? 0), 0),
)
const totalImages = computed(() => selectedJobStatus.value?.files.length ?? 0)

// キャンセル時の「処理済み枚数」は totalImages(未処理含む全件) - totalErrors(エラーのある
// ファイル数のみ) では、キャンセルにより未処理のまま終わった画像が「処理済み」に誤って
// 含まれてしまう。extractedImages.completed + failed(727行目付近の集計と同じ値)を使う。
const processedImageCount = computed(
  () => (selectedJobStatus.value?.extractedImages.completed ?? 0) + (selectedJobStatus.value?.extractedImages.failed ?? 0),
)

/** エラーがあるファイルに加えて、キャンセル等により未処理のまま終わったファイル
 *  (url===null かつ errors.length===0 で、ジョブが終端状態)も対象にする。
 *  「どのファイルが未処理のまま中断されたか」を確認できるようにする要件に対応する。 */
const errorFiles = computed(() =>
  (selectedJobStatus.value?.files ?? []).filter(
    (f) =>
      f.errors.length > 0 ||
      (f.url === null && isTerminal.value && selectedJobStatus.value?.status !== 'completed'),
  ),
)

function isUnprocessedFile(f: ProcessedImageFileResult): boolean {
  return f.errors.length === 0 && f.url === null
}

// モックの processingModeBadge/taskModeLabel に相当。mask=true(face_mask/text_maskのいずれかON)なら「チェック＋マスク」。
const executionParameters = computed(() => selectedJobStatus.value?.executionParameters ?? null)
const didMask = computed(() => Boolean(executionParameters.value?.faceMask || executionParameters.value?.textMask))

/** モックの task.title(hero-summary の h2)に相当。一覧経由なら entryTitle と同じ規則で
 *  「{受付日時} のタスク/チェック」を合成する。共有URL等で直接開いた場合は登録日時が無いため jobId で代替する。 */
const detailTitle = computed(() => {
  if (!selectedStartDate.value) return selectedJobId.value ?? ''
  const suffix = executionParameters.value ? (didMask.value ? 'のタスク' : 'のチェック') : 'のタスク'
  return `${formatDateTime(selectedStartDate.value)} ${suffix}`
})

const processingModeLabel = computed(() => (didMask.value ? 'チェック＋マスク' : 'チェックのみ'))

/** モックの setHeader() に相当。STEP(タスク一覧 / ファイル一覧 / ファイル詳細)ごとに
 *  トップバーの見出し・説明文が変わる。親(App.vue)がトップバーのh1/pに使う。 */
const drilledGroup = computed(() => (isDrilledIntoFile.value ? resultExplorerRef.value?.selectedGroup ?? null : null))

const pageHeaderTitle = computed(() => {
  if (drilledGroup.value) return drilledGroup.value.uploadFileName
  if (view.value === 'detail' && selectedJobId.value) return `処理結果：${selectedJobId.value}`
  return '処理結果'
})

const pageHeaderSubtitle = computed(() => {
  const group = drilledGroup.value
  if (group) {
    return `${selectedJobId.value} · ${group.detectedCount} / ${group.images.length}枚で個人情報を検知`
  }
  if (view.value === 'detail' && executionParameters.value) {
    return `${processingModeLabel.value}${selectedStartDate.value ? ` · ${formatDateTime(selectedStartDate.value)} 登録` : ''}`
  }
  return 'タスク → ファイル → 画像 の順に絞り込んで確認します'
})
const usedRegexEntries = computed(() => Object.entries(executionParameters.value?.regex ?? {}))

// モックの taskAlert(状態別の説明バナー)に相当。ジョブ状態名はモックと異なる(processing→running等)ため読み替える。
const isTerminal = computed(() => TERMINAL_STATUSES.includes(selectedJobStatus.value?.status ?? 'queued'))
type TaskAlertTone = 'info' | 'warning' | 'danger' | 'success'
const taskAlert = computed<{ tone: TaskAlertTone; icon: string; title: string; body: string } | null>(() => {
  const status = selectedJobStatus.value?.status
  if (!status) return null
  if (!isTerminal.value) {
    return {
      tone: 'info',
      icon: 'mdi-format-list-bulleted',
      title: status === 'running' ? 'AI処理を実行中です' : 'キューで処理を待っています',
      body: '完了するまでダウンロードは利用できません。進捗は作業キューで確認できます。',
    }
  }
  if (status === 'cancelled') {
    return {
      tone: 'warning',
      icon: 'mdi-alert-circle-outline',
      title: 'このタスクは途中でキャンセルされました',
      body: `${processedImageCount.value} / ${totalImages.value}枚が処理済みです。処理済み分のダウンロードと、未処理を含む全件CSVを利用できます。`,
    }
  }
  if (totalErrors.value > 0) {
    return {
      tone: 'danger',
      icon: 'mdi-alert-circle-outline',
      title: `${totalErrors.value}件のファイルでエラーが発生しました`,
      body: 'エラーのファイルはスキップし、それ以外は正常に完了しています。「エラー・未処理」タブで確認できます。',
    }
  }
  return {
    tone: 'success',
    icon: 'mdi-check',
    title: 'すべての処理が完了しました',
    body: `結果は ${formatDateTime(selectedJobStatus.value?.expiresAt ?? '')} まで閲覧・ダウンロードできます。`,
  }
})

const isSummaryDownloading = ref(false)

async function downloadBundle() {
  await downloadGeneratedFile(selectedJobStatus.value?.resultFile ?? null, isBundleDownloading)
}

async function downloadResultSummary() {
  // サーバーは download_name を常に "results.csv" 固定で返す(FaceMask/user-api
  // _build_download_name は display_name="results.csv" から生成するため)。
  // モックの downloadCsv() は `masky_{taskId}_results.csv` という、どのタスクの
  // ファイルか分かる名前にしているため、クライアント側でそれに合わせて上書きする。
  const jobId = selectedJobId.value
  const fileName = jobId ? `masky_${jobId}_results.csv` : undefined
  await downloadGeneratedFile(selectedJobStatus.value?.resultSummary ?? null, isSummaryDownloading, fileName)
}

async function downloadGeneratedFile(
  resource: GeneratedFileResource | null,
  loadingFlag: Ref<boolean>,
  fileNameOverride?: string,
) {
  const jobId = selectedJobId.value
  if (!jobId || !resource?.url) return
  loadingFlag.value = true
  try {
    const blob = await fetchGeneratedFileBlob(resource.url, getJobToken(jobId) ?? '')
    const objectUrl = URL.createObjectURL(blob)
    const downloadName = fileNameOverride ?? resource.downloadName
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = downloadName
    link.click()
    URL.revokeObjectURL(objectUrl)
    toast.success('ダウンロードを開始しました', downloadName)
  } catch (err) {
    toast.error('ダウンロードに失敗しました', err instanceof Error ? err.message : String(err))
  } finally {
    loadingFlag.value = false
  }
}

const shareDialogOpen = ref(false)
const shareUrlValue = ref('')
const shareCopied = ref(false)

function openShareDialog() {
  const jobId = selectedJobId.value
  const token = jobId ? getJobToken(jobId) : null
  if (!jobId || !token) return
  shareUrlValue.value = buildShareUrl(jobId, token)
  shareCopied.value = false
  shareDialogOpen.value = true
}

async function copyShareUrl() {
  try {
    await navigator.clipboard.writeText(shareUrlValue.value)
    shareCopied.value = true
    toast.success('共有URLをコピーしました')
  } catch {
    // クリップボードAPIが使えない場合でも、テキストフィールドから手動で選択・コピーできる
    toast.error('コピーできませんでした', '手動で選択してコピーしてください')
  }
}

refreshList()
defineExpose({ refreshList, openTaskById, backToList, pageHeaderTitle, pageHeaderSubtitle })
</script>

<template>
  <div class="content wide">
    <!-- タスク一覧(STEP 1) -->
    <template v-if="view === 'list'">
      <FlowNav
        :steps="[
          { label: 'STEP 1', title: 'タスクを選ぶ', value: '一覧から選択', clickable: false },
          { label: 'STEP 2', title: 'ファイルを選ぶ', value: '—', clickable: false },
          { label: 'STEP 3', title: '画像を確認', value: '—', clickable: false },
        ]"
        :current="1"
      />

      <p v-if="errorMessage" class="alert danger">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        <span class="alert-text" :title="errorMessage">{{ errorMessage }}</span>
      </p>

      <section v-else class="card">
        <div class="toolbar">
          <div class="toolbar-group">
            <v-text-field
              v-model="resultSearch"
              placeholder="タスクIDで検索"
              density="comfortable"
              hide-details
              prepend-inner-icon="mdi-magnify"
              class="result-search"
            />
            <v-select
              v-model="resultFilter"
              :items="RESULT_FILTER_OPTIONS"
              item-title="label"
              item-value="value"
              density="comfortable"
              hide-details
              class="result-filter"
            />
          </div>
          <div class="row">
            <span class="mk-muted" style="font-size: 13px">{{ filteredJobs.length }}件</span>
            <button class="btn outline small" :disabled="loading" @click="refreshList">
              <v-icon icon="mdi-refresh" size="16" />
              今すぐ更新
            </button>
          </div>
        </div>

        <div class="card-body">
          <p v-if="loadedOnce && filteredJobs.length === 0" class="mk-muted empty-note">
            {{ jobs.length === 0 ? '処理結果はまだありません。' : '該当するタスクがありません。検索語または絞り込み条件を変更してください。' }}
          </p>

          <div v-else class="result-card-grid">
            <article
              v-for="entry in filteredJobs"
              :key="entry.jobId"
              class="task-card"
              :class="`task-${entry.status}`"
            >
              <div class="task-card-top">
                <div class="row wrap">
                  <span class="task-id">{{ entry.jobId }}</span>
                  <span class="badge" :class="STATUS_COLORS[entry.status]">{{ STATUS_LABELS[entry.status] }}</span>
                </div>
                <span class="badge" :class="isOwnJob(entry.jobId) ? 'badge-primary' : 'badge-neutral'">
                  <v-icon :icon="isOwnJob(entry.jobId) ? 'mdi-key-outline' : 'mdi-lock-outline'" size="12" />
                  {{ isOwnJob(entry.jobId) ? '閲覧可能' : '要トークン' }}
                </span>
              </div>

              <h3 class="task-title" :title="entryTitle(entry)">{{ entryTitle(entry) }}</h3>

              <div class="task-headline" :class="{ hit: (detectedCount(entry) ?? 0) > 0 }">
                <div class="task-headline-main">
                  <span class="big">{{ detectedCount(entry) ?? '非公開' }}</span>
                  <span v-if="detectedCount(entry) !== null" class="unit">枚に個人情報</span>
                </div>
                <div class="headline-note">
                  <template v-if="entry.status === 'cancelled'">
                    {{ entry.extractedImages.completed + entry.extractedImages.failed }} /
                    {{ entry.extractedImages.total ?? '—' }}枚を処理済み
                  </template>
                  <template v-else>全{{ entry.extractedImages.total ?? '—' }}枚の処理が完了</template>
                  <template v-if="detectedBreakdown(entry)">
                    · 目 {{ detectedBreakdown(entry)?.faceCount }}件 · 文字 {{ detectedBreakdown(entry)?.textCount }}件
                  </template>
                  <template v-if="detectedCount(entry) === null">· 検知件数は開いて確認できます</template>
                </div>
              </div>

              <div class="task-meta-grid">
                <div class="task-meta-item">
                  <span>処理モード</span>
                  <strong>{{ entry.executionParameters ? (entryDidMask(entry) ? 'チェック＋マスク' : 'チェックのみ') : '非公開' }}</strong>
                </div>
                <div class="task-meta-item">
                  <span>ファイル</span>
                  <strong>{{ entry.uploadedFiles.total ?? '—' }}件</strong>
                </div>
                <div class="task-meta-item">
                  <span>エラー</span>
                  <strong :class="{ 'text-danger': entry.extractedImages.failed > 0 }">
                    {{ entry.extractedImages.failed }}件
                  </strong>
                </div>
              </div>

              <div class="task-card-foot">
                <div class="expiry">
                  <v-icon icon="mdi-clock-outline" size="15" />
                  <span>保持期限 {{ formatDateTime(entry.expiryDate) }}</span>
                </div>
                <button class="btn primary small" @click="openTask(entry)">
                  結果を見る
                  <v-icon icon="mdi-chevron-right" size="16" />
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </template>

    <!-- タスク詳細(STEP 2/3) -->
    <template v-else-if="view === 'detail'">
      <FlowNav :steps="flowSteps" :current="flowCurrentStep" @step-click="onFlowStepClick" />

      <!-- 保護されたタスク(トークン未保持): モックの renderLockedTask に相当 -->
      <div v-if="isLocked" class="empty card locked-card">
        <div>
          <v-icon icon="mdi-lock-outline" size="28" class="mk-muted" />
          <h3>このタスクの詳細は保護されています</h3>
          <p>ファイル名、画像、検知結果を確認するには、タスク登録時に発行されたトークンが必要です。</p>
          <div class="stack tight unlock-form">
            <v-text-field
              v-model="unlockTokenInput"
              label="タスクトークン"
              density="comfortable"
              :error="!!unlockError"
              :error-messages="unlockError ? [unlockError] : []"
              @keyup.enter="unlockTask"
            />
            <v-btn color="primary" variant="flat" :loading="unlockVerifying" :disabled="!unlockTokenInput.trim()" @click="unlockTask">
              <v-icon icon="mdi-key-outline" start size="16" />
              トークンを入力
            </v-btn>
          </div>
        </div>
      </div>

      <div v-else-if="detailLoading" class="mk-muted empty-note">読み込み中…</div>

      <p v-else-if="detailError" class="alert danger">
        <v-icon icon="mdi-alert-circle-outline" size="18" />
        <span class="alert-text" :title="detailError">{{ detailError }}</span>
      </p>

      <template v-else-if="selectedJobStatus">
        <!-- タスク全体の概要。モックの renderFileDetail(ファイル単位の専用画面)に入っている間は隠す。 -->
        <div v-show="!isDrilledIntoFile">
        <section class="hero-summary">
          <div class="hero-top">
            <div>
              <div class="row wrap">
                <span class="badge" :class="STATUS_COLORS[selectedJobStatus.status]">
                  {{ STATUS_LABELS[selectedJobStatus.status] }}
                </span>
                <span v-if="executionParameters" class="badge badge-mode">
                  <svg v-if="didMask" viewBox="0 0 24 24" width="14" height="14">
                    <path d="M3.2 9.1c2.5-2 5.3-3 8.8-3s6.3 1 8.8 3l-1.1 6.2c-.2 1.2-1.3 2.1-2.5 2.1h-2.4c-1 0-1.9-.6-2.3-1.5L12 14.7l-.5 1.2c-.4.9-1.3 1.5-2.3 1.5H6.8c-1.2 0-2.3-.9-2.5-2.1L3.2 9.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                    <path d="M5 10.2c1.9-.8 4-.9 6.3-.2M19 10.2c-1.9-.8-4-.9-6.3-.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  <v-icon v-else icon="mdi-eye-outline" size="14" />
                  {{ processingModeLabel }}
                </span>
              </div>
              <h2>{{ detailTitle }}</h2>
              <p>
                <template v-if="selectedStartDate">登録 {{ formatDateTime(selectedStartDate) }} · </template>
                保持期限 {{ formatDateTime(selectedJobStatus.expiresAt ?? '') }}
              </p>
            </div>
            <div class="hero-actions">
              <button v-if="selectedJobId && isOwnJob(selectedJobId)" class="btn outline" @click="openShareDialog">
                <v-icon icon="mdi-link-variant" size="16" />
                共有URL
              </button>
              <button
                v-if="selectedJobStatus.resultSummary"
                class="btn outline"
                :disabled="isSummaryDownloading"
                @click="downloadResultSummary"
              >
                <v-progress-circular v-if="isSummaryDownloading" indeterminate size="16" width="2" />
                <v-icon v-else icon="mdi-download" size="16" />
                結果CSV
              </button>
              <button
                v-if="selectedJobStatus.resultFile"
                class="btn primary"
                :disabled="isBundleDownloading"
                @click="downloadBundle"
              >
                <v-progress-circular v-if="isBundleDownloading" indeterminate size="16" width="2" />
                <v-icon v-else icon="mdi-download" size="16" />
                {{ selectedJobStatus.status === 'cancelled' ? '処理済み分を一括保存' : 'マスク画像を一括保存' }}
              </button>
              <button v-if="!isTerminal" class="btn primary" @click="emit('open-jobs-tab')">
                <v-icon icon="mdi-format-list-bulleted" size="16" />
                キューを確認
              </button>
            </div>
          </div>
        </section>

        <div class="metric-grid mt-16">
          <div class="metric emphasis">
            <div class="metric-top">
              <span>個人情報を含む画像</span>
              <v-icon icon="mdi-alert-circle-outline" size="18" />
            </div>
            <div class="metric-value">{{ totalDetected }}<small> / {{ totalImages }}枚</small></div>
            <div class="metric-note">検知の内訳：目 {{ totalFaceCount }}件 · 文字 {{ totalTextCount }}件</div>
          </div>
          <div class="metric">
            <div class="metric-top">
              <span>アップロードファイル</span>
              <v-icon icon="mdi-file-outline" size="18" />
            </div>
            <div class="metric-value">{{ selectedJobStatus.uploadedFiles.total ?? '—' }}<small> 件</small></div>
            <div class="metric-note">
              処理済み {{ selectedJobStatus.extractedImages.completed + selectedJobStatus.extractedImages.failed }} / {{ selectedJobStatus.extractedImages.total ?? '—' }}枚
            </div>
          </div>
          <div class="metric">
            <div class="metric-top">
              <span>エラー</span>
              <v-icon icon="mdi-information-outline" size="18" />
            </div>
            <div class="metric-value" :class="{ 'text-danger': totalErrors > 0 }">{{ totalErrors }}<small> 件</small></div>
            <div class="metric-note">{{ totalErrors ? 'エラーのファイルはスキップされました' : 'エラーはありません' }}</div>
          </div>
        </div>

        <div v-if="taskAlert" class="mt-16">
          <div class="alert" :class="taskAlert.tone">
            <v-icon :icon="taskAlert.icon" size="18" />
            <div><strong>{{ taskAlert.title }}</strong>{{ taskAlert.body }}</div>
          </div>
        </div>
        </div>

        <section class="card mt-16" :class="{ 'card--flush': isDrilledIntoFile }">
          <div v-show="!isDrilledIntoFile" class="tabs" role="tablist">
            <button class="tab" :class="{ active: taskTab === 'files' }" @click="taskTab = 'files'">
              ファイル一覧
              <span class="badge badge-neutral">{{ selectedJobStatus.uploadedFiles.total ?? 0 }}</span>
            </button>
            <button class="tab" :class="{ active: taskTab === 'errors' }" @click="taskTab = 'errors'">
              エラー・未処理
              <span class="badge" :class="totalErrors > 0 ? 'badge-danger' : 'badge-neutral'">{{ totalErrors }}</span>
            </button>
            <button class="tab" :class="{ active: taskTab === 'config' }" @click="taskTab = 'config'">
              処理設定
            </button>
          </div>

          <div v-show="taskTab === 'files'" :class="{ 'card-body': !isDrilledIntoFile }">
            <ResultExplorer
              ref="resultExplorerRef"
              :job-status="selectedJobStatus"
              :token="getJobToken(selectedJobId ?? '') ?? ''"
              :uploaded-files="[]"
              :task-id="selectedJobId ?? ''"
            />
          </div>

          <div v-show="taskTab === 'errors'" class="card-body">
            <div v-if="errorFiles.length === 0" class="empty">
              <div>
                <v-icon icon="mdi-check" size="24" />
                <h3>エラーや未処理ファイルはありません</h3>
                <p>タスク内のすべてのファイルが正常に処理されました。</p>
              </div>
            </div>
            <template v-else>
              <div class="row between mb-12">
                <div>
                  <strong>{{ errorFiles.length }}件のエラー・未処理</strong>
                  <div class="cell-sub">後続ファイルの処理は継続されています</div>
                </div>
                <button
                  v-if="selectedJobStatus.resultSummary"
                  class="btn outline small"
                  :disabled="isSummaryDownloading"
                  @click="downloadResultSummary"
                >
                  <v-icon icon="mdi-download" size="14" />
                  CSVで確認
                </button>
              </div>
              <div class="error-list">
                <div v-for="file in errorFiles" :key="file.displayName" class="error-item">
                  <div>
                    <div class="error-path">
                      <v-icon :icon="isUnprocessedFile(file) ? 'mdi-clock-outline' : 'mdi-alert-circle-outline'" size="16" />
                      <span>{{ file.displayName }}</span>
                    </div>
                    <div class="error-reason">
                      <template v-if="isUnprocessedFile(file)">
                        キャンセルにより処理されませんでした
                      </template>
                      <template v-else>
                        {{ file.errors.map((err) => err.message).join(' / ') }}
                      </template>
                    </div>
                  </div>
                  <span class="badge" :class="isUnprocessedFile(file) ? 'badge-neutral' : 'badge-danger'">
                    {{ isUnprocessedFile(file) ? '未処理' : 'エラー' }}
                  </span>
                </div>
              </div>
            </template>
          </div>

          <div v-show="taskTab === 'config'" class="card-body">
            <div v-if="!executionParameters" class="mk-muted">
              処理条件を取得できませんでした。
            </div>
            <div v-else class="config-grid">
              <div class="stack">
                <div class="field">
                  <label>処理モード</label>
                  <div>
                    <span class="badge badge-mode">
                      <svg v-if="didMask" viewBox="0 0 24 24" width="14" height="14">
                        <path d="M3.2 9.1c2.5-2 5.3-3 8.8-3s6.3 1 8.8 3l-1.1 6.2c-.2 1.2-1.3 2.1-2.5 2.1h-2.4c-1 0-1.9-.6-2.3-1.5L12 14.7l-.5 1.2c-.4.9-1.3 1.5-2.3 1.5H6.8c-1.2 0-2.3-.9-2.5-2.1L3.2 9.1Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                        <path d="M5 10.2c1.9-.8 4-.9 6.3-.2M19 10.2c-1.9-.8-4-.9-6.3-.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      </svg>
                      <v-icon v-else icon="mdi-eye-outline" size="14" />
                      {{ processingModeLabel }}
                    </span>
                  </div>
                </div>
                <div class="field">
                  <label>チェック対象</label>
                  <div class="row wrap">
                    <span class="badge" :class="executionParameters.faceCheck ? 'badge-primary' : 'badge-neutral'">
                      <v-icon icon="mdi-eye-outline" size="14" />
                      目 {{ executionParameters.faceCheck ? 'ON' : 'OFF' }}
                    </span>
                    <span class="badge" :class="executionParameters.textCheck ? 'badge-primary' : 'badge-neutral'">
                      <v-icon icon="mdi-format-text" size="14" />
                      文字 {{ executionParameters.textCheck ? 'ON' : 'OFF' }}
                    </span>
                  </div>
                </div>
                <div class="field">
                  <label>保持期限</label>
                  <div class="row">
                    <v-icon icon="mdi-calendar-outline" size="16" />
                    <strong>{{ formatDateTime(selectedJobStatus?.expiresAt ?? '') }}</strong>
                  </div>
                  <p class="field-help">元ファイル・処理結果・マスク済み画像を同じ期限で削除します。</p>
                </div>
              </div>
              <div class="field">
                <label>文字検知に使用した正規表現</label>
                <div v-if="usedRegexEntries.length === 0" class="mk-muted">
                  文字検知は行っていません。
                </div>
                <div v-else class="stack tight">
                  <div v-for="[name, pattern] in usedRegexEntries" :key="name" class="detection-item">
                    <span>{{ name }}</span>
                    <code class="pattern-code">{{ pattern }}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </template>

    <!-- 結果を共有(モックの shareTask モーダルに相当) -->
    <v-dialog v-model="shareDialogOpen" max-width="480">
      <v-card rounded="lg">
        <v-card-title class="dialog-title">
          結果を共有
          <div class="dialog-subtitle">{{ selectedJobId }}</div>
        </v-card-title>
        <v-card-text class="stack tight">
          <div class="field">
            <label>共有URL</label>
            <div class="share-url-row">
              <v-text-field :model-value="shareUrlValue" readonly density="comfortable" hide-details />
              <v-btn color="secondary" variant="flat" @click="copyShareUrl">
                <v-icon icon="mdi-content-copy" size="16" start />
                {{ shareCopied ? 'コピーしました' : 'コピー' }}
              </v-btn>
            </div>
          </div>
          <div class="alert warning">
            <v-icon icon="mdi-alert-circle-outline" size="18" />
            <div><strong>共有URLは認証情報です。</strong>社内の承認された経路でのみ共有してください。このURLを受け取った人は結果の閲覧・ダウンロードができます。</div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="shareDialogOpen = false">閉じる</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 一覧から他人のタスクを開く(モックの showTaskUnlock に相当。一覧を表示したまま重ねる) -->
    <v-dialog v-model="unlockDialogOpen" max-width="440">
      <v-card v-if="unlockDialogEntry" rounded="lg">
        <v-card-title class="dialog-title">
          保護されたタスクを開く
          <div class="dialog-subtitle">{{ unlockDialogEntry.jobId }}</div>
        </v-card-title>
        <v-card-text class="stack tight">
          <div class="alert info">
            <v-icon icon="mdi-lock-outline" size="18" />
            <div>結果の閲覧・ダウンロード権限を確認します。タスク登録時に発行されたトークンを入力してください。</div>
          </div>
          <v-text-field
            v-model="unlockDialogTokenInput"
            label="タスクトークン"
            density="comfortable"
            autofocus
            :error="!!unlockDialogError"
            :error-messages="unlockDialogError ? [unlockDialogError] : []"
            @keyup.enter="verifyUnlockDialogToken"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="unlockDialogOpen = false">キャンセル</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="unlockDialogVerifying"
            :disabled="!unlockDialogTokenInput.trim()"
            @click="verifyUnlockDialogToken"
          >
            結果を開く
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.content {
  width: min(1240px, 100%);
  margin: 0;
}

.content.wide {
  width: min(1420px, 100%);
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
  color: var(--mk-muted);
  font-size: 14.5px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--mk-border);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.result-search {
  width: 260px;
}

.result-filter {
  width: 190px;
}

.empty-note {
  padding: 2rem 0;
  text-align: center;
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

/* 詳細はホバー時のtitle属性で見せる(ネイティブツールチップ)。通常時は1行に切り詰めて画面を占有しない。 */
.alert-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: help;
}

.alert.danger {
  color: #92323b;
  background: #ffeff0;
  border-color: #efc9cd;
}

.alert.info {
  color: #275b83;
  background: #eaf4fc;
  border-color: #cde4f4;
}

.alert.success {
  color: #22664e;
  background: #e5f5ee;
  border-color: #c8e7db;
}

.alert.warning {
  color: #7d4c08;
  background: #fff3dd;
  border-color: #efd8aa;
}

.dialog-title {
  display: block;
  padding: 20px 24px 4px;
}

.dialog-subtitle {
  margin-top: 4px;
  color: var(--mk-muted);
  font-size: 12.5px;
  font-weight: 400;
}

.field {
  display: grid;
  gap: 7px;
}

.field > label {
  color: var(--mk-muted);
  font-size: 13px;
  font-weight: 800;
}

.field-help {
  margin: 0;
  color: #8892a3;
  font-size: 12.5px;
  line-height: 1.55;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.detection-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--mk-border);
  border-radius: 9px;
  background: #f8fafc;
  font-size: 13px;
}

.pattern-code {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #34415a;
  font-size: 12.5px;
}

@media (max-width: 900px) {
  .config-grid {
    grid-template-columns: 1fr;
  }
}

.share-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-url-row .v-text-field {
  flex: 1;
}

.result-card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 16px;
}

.task-card {
  height: 100%;
  min-height: 280px;
  padding: 21px 22px;
  display: grid;
  grid-template-rows: auto auto auto auto 1fr;
  gap: 11px;
  border: 1px solid var(--mk-border);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 2px 8px rgba(31, 48, 78, .05);
}

.task-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.task-id {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
  font-weight: 800;
  color: var(--mk-muted);
}

.task-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-headline {
  display: grid;
  align-content: center;
  padding: 13px 16px;
  border-radius: 12px;
  background: #f7f9fc;
  border: 1px solid #e8edf4;
}

.task-headline.hit {
  background: #fff7ed;
  border-color: #f3ddb6;
}

.task-headline-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.task-headline .big {
  font-size: 31px;
  font-weight: 800;
  letter-spacing: -.03em;
  line-height: 1;
}

.task-headline.hit .big {
  color: #b05e0a;
}

.task-headline .unit {
  color: var(--mk-muted);
  font-size: 13.5px;
  font-weight: 700;
}

.headline-note {
  margin-top: 7px;
  color: var(--mk-muted);
  font-size: 12.5px;
}

.task-meta-grid {
  display: grid;
  grid-template-columns: 1.35fr .75fr .75fr;
  gap: 8px;
}

.task-meta-item {
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--mk-border);
  border-radius: 10px;
  background: #fbfcfe;
}

.task-meta-item span {
  display: block;
  color: #8892a3;
  font-size: 11.5px;
  font-weight: 700;
}

.task-meta-item strong {
  display: block;
  margin-top: 1px;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card-foot {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 10px;
}

.expiry {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--mk-muted);
  font-size: 12.5px;
  min-width: 0;
}

.expiry span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-summary {
  position: relative;
  overflow: hidden;
  padding: 24px 26px;
  border-radius: 16px;
  color: #f7f9ff;
  background: linear-gradient(128deg, #152443 0%, #263d73 62%, #28626e 125%);
  box-shadow: 0 10px 28px rgba(20, 34, 59, .12), 0 2px 8px rgba(20, 34, 59, .06);
}

.hero-top {
  display: flex;
  justify-content: space-between;
  gap: 18px;
}

.hero-summary .task-id {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
  font-weight: 800;
  color: #c2cee3;
}

.hero-summary h2 {
  margin: 9px 0 0;
  font-size: 23px;
  letter-spacing: -.02em;
}

.hero-summary p {
  margin: 6px 0 0;
  color: #c2cee3;
  font-size: 13px;
}

.hero-actions {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.hero-actions .btn.outline {
  color: #eef3ff;
  background: rgba(255, 255, 255, .09);
  border-color: rgba(255, 255, 255, .22);
}

.hero-actions .btn.outline:hover {
  background: rgba(255, 255, 255, .15);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.metric {
  padding: 18px 20px;
  border: 1px solid var(--mk-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
}

.metric-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--mk-muted);
  font-size: 13px;
  font-weight: 750;
}

.metric.emphasis {
  border-color: #f0d9aa;
  background: #fffaf0;
}

.metric-value {
  margin-top: 10px;
  font-size: 31px;
  line-height: 1.1;
  font-weight: 800;
  letter-spacing: -.03em;
}

.metric-value small {
  font-size: 15px;
  color: var(--mk-muted);
  font-weight: 700;
  letter-spacing: 0;
}

.metric.emphasis .metric-value {
  color: #a3570a;
}

.metric-note {
  margin-top: 6px;
  color: var(--mk-muted);
  font-size: 12.5px;
}

.text-danger {
  color: #c73f4b;
}

.mt-16 {
  margin-top: 16px;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 52px;
  padding: 0 8px;
  border-bottom: 1px solid var(--mk-border);
}

.tab {
  position: relative;
  min-height: 51px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  font-weight: 750;
  font-size: 14px;
  cursor: pointer;
}

.tab:hover {
  color: var(--mk-text);
}

.tab.active {
  color: var(--mk-primary);
}

.tab.active::after {
  content: "";
  position: absolute;
  left: 13px;
  right: 13px;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--mk-primary);
}

.card-body {
  padding: 22px;
}

.empty {
  min-height: 200px;
  padding: 30px;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--mk-muted);
}

.card {
  background: #fff;
  border: 1px solid var(--mk-border);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
}

/* モックの renderFileDetail はタブカードに包まれない独立ページなので、枠を消して
   ResultExplorer 自体をそのまま表示する。 */
.card--flush {
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.locked-card h3 {
  margin: 12px 0 0;
  color: var(--mk-text);
}

.locked-card p {
  margin: 8px 0 0;
  max-width: 420px;
}

.unlock-form {
  margin: 18px auto 0;
  max-width: 320px;
  text-align: left;
}

.stack {
  display: grid;
  gap: 18px;
}

.stack.tight {
  gap: 10px;
}

.error-list {
  display: grid;
  gap: 10px;
}

.error-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border: 1px solid #efcdd1;
  border-radius: 11px;
  background: #fff8f8;
}

.error-path {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 13.5px;
  font-weight: 720;
}

.error-reason {
  margin: 5px 0 0 25px;
  color: #8d5057;
  font-size: 12.5px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 4px 11px;
  border: 1px solid transparent;
  border-radius: 99px;
  font-weight: 700;
  font-size: 12.5px;
}

.badge-primary {
  color: var(--mk-primary);
  background: rgba(0, 123, 167, .08);
}

/* 処理モード(チェックのみ/チェック＋マスク)専用。モックの .badge.primary と同じ
   --primary/--primary-soft(App.vue のグローバル変数)を使う。badge-primary(セルリアン
   ブルー系・薄い背景)は紺色の hero-summary 背景上でコントラストが低く視認しづらいため分ける。 */
.badge-mode {
  color: var(--primary);
  background: var(--primary-soft);
}

.badge-neutral {
  color: var(--mk-muted);
  background: #f3f5f8;
}

.badge-danger {
  color: #c73f4b;
  background: #ffeff0;
}

.badge-success {
  color: var(--mk-success);
  background: #e5f5ee;
}

.badge-warning {
  color: var(--mk-warning-deep);
  background: #fff3dd;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row.wrap {
  flex-wrap: wrap;
}

.row.between {
  justify-content: space-between;
  align-items: flex-start;
}

.mb-12 {
  margin-bottom: 12px;
}

.cell-sub {
  margin-top: 2px;
  color: var(--mk-muted);
  font-size: 12.5px;
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
  background: #fff;
  color: var(--mk-text);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}

.btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.btn.primary {
  color: #fff;
  background: linear-gradient(180deg, #4169da, #3055c3);
  border-color: #3055c3;
}

.btn.outline {
  border-color: var(--mk-border);
  background: #fff;
}

.btn.small {
  min-height: 35px;
  padding: 7px 12px;
  font-size: 13px;
  border-radius: 9px;
}

@media (max-width: 900px) {
  .result-card-grid {
    grid-template-columns: 1fr;
  }
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
