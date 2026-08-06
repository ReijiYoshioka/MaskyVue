<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toReadableMessage } from '@/api/http'
import { fetchJobList, fetchJobStatusById, requestJobAction, type JobAction } from '@/api/userApi'
import { getJobToken, pruneJobTokens, rememberJobToken } from '@/state/jobTokenStore'
import { useToast } from '@/composables/useToast'
import type { AuthRequirements, JobListEntry, ProcessJobStatus } from '@/types/processJob'

// モックの「結果を開く」(完了済みジョブから処理結果タブへの遷移)を親に委譲する。
const emit = defineEmits<{ 'open-result': [jobId: string] }>()

const toast = useToast()

// モックの queueCountdown に合わせて8秒間隔で常に自動更新する
const AUTO_REFRESH_SECONDS = 8

const jobs = ref<JobListEntry[]>([])
const authRequirements = ref<AuthRequirements | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const actionMessage = ref('')
const loadedOnce = ref(false)
const pendingAction = ref<string | null>(null) // `${jobId}:${action}` 実行中の操作
const autoRefreshCountdown = ref(AUTO_REFRESH_SECONDS)

// 表示スコープ: 全員のジョブ / 自分のジョブのみ（Flutter版の「全員/自分のみ」に合わせる）
type JobsScope = 'everyone' | 'ownOnly'
const scope = ref<JobsScope>('everyone')

let countdownTimer: ReturnType<typeof setInterval> | null = null

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

// 「自分のみ」選択時は、トークンを保持している自分のジョブだけに絞る
const visibleJobs = computed(() =>
  scope.value === 'ownOnly' ? jobs.value.filter((j) => isOwnJob(j.jobId)) : jobs.value,
)

// モックの queue-strip(処理中/処理待ち/一時停止の集計)に相当。
// 表示中のカード枚数(visibleJobs)と件数を一致させるため、集計元は visibleJobs にする
// (「自分のみ」スコープ選択時に jobs.value 全体から集計するとカード枚数とズレる)。
const processingCount = computed(() => visibleJobs.value.filter((j) => j.status === 'running').length)
const waitingCount = computed(() => visibleJobs.value.filter((j) => j.status === 'queued').length)
const pausedCount = computed(() => visibleJobs.value.filter((j) => j.status === 'paused').length)

// 「◯番目に処理予定」を出すための、queued ジョブの待ち行列(受付順)
const queuedJobIds = computed(() =>
  jobs.value.filter((j) => j.status === 'queued').map((j) => j.jobId),
)

function formatDate(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isExpired(expiryDateIso: string): boolean {
  if (!expiryDateIso) return false
  const expiryDate = new Date(expiryDateIso)
  return expiryDate < new Date()
}

function getDaysUntilExpiry(expiryDateIso: string): number | null {
  if (!expiryDateIso) return null
  const expiryDate = new Date(expiryDateIso)
  const now = new Date()
  const diffMs = expiryDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return diffDays
}

function isExpirySoon(expiryDateIso: string): boolean {
  const days = getDaysUntilExpiry(expiryDateIso)
  return days !== null && days < 7
}

function progressPercent(entry: JobListEntry): number {
  const total = entry.extractedImages.total
  if (!total) return 0
  const done = entry.extractedImages.completed + entry.extractedImages.failed
  return Math.min(100, Math.round((done / total) * 100))
}

function processedCount(entry: JobListEntry): number {
  return entry.extractedImages.completed + entry.extractedImages.failed
}

/** モックの processingModeBadge(item.mode) に相当。executionParameters が非公開(null)の場合は表示しない。 */
function entryDidMask(entry: JobListEntry): boolean {
  return Boolean(entry.executionParameters?.faceMask || entry.executionParameters?.textMask)
}

function positionLabel(entry: JobListEntry): { main: string; sub: string; cls: string } {
  switch (entry.status) {
    case 'running':
      return { main: '実行中', sub: 'AI処理', cls: 'run' }
    case 'queued': {
      const index = queuedJobIds.value.indexOf(entry.jobId)
      return { main: `${index + 1}番目`, sub: '処理待ち', cls: '' }
    }
    case 'paused':
    case 'pausing':
      return { main: '停止中', sub: '一時停止', cls: '' }
    case 'cancelling':
      // キャンセル要求は受理されたが、現在の画像の処理が終わるまでは完了しない中間状態。
      // 完了済みの cancelled と混同しないよう表示を分ける。
      return { main: '停止中', sub: 'キャンセル中', cls: '' }
    case 'completed':
      return { main: '完了', sub: '処理済み', cls: '' }
    default:
      return { main: '中止', sub: 'キャンセル', cls: '' }
  }
}

function isOwnJob(jobId: string): boolean {
  return getJobToken(jobId) !== null
}

/** ジョブ制御が可能か: 制御が公開されているか、自分のジョブ(トークン保持)なら可 */
function canControl(jobId: string): boolean {
  if (!(authRequirements.value?.jobControlAuthRequired ?? false)) return true
  return isOwnJob(jobId)
}

/** 状態遷移のルール: どの状態でどの操作が意味を持つか(README準拠) */
function availableActions(entry: JobListEntry): JobAction[] {
  switch (entry.status) {
    case 'queued':
      return ['prioritize', 'pause', 'cancel']
    case 'running':
      return ['pause', 'cancel']
    case 'pausing':
      return ['resume', 'cancel'] // resume=一時停止要求の取り消し
    case 'paused':
      return ['resume', 'prioritize', 'cancel']
    case 'cancelling':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return []
  }
}

const ACTION_LABELS: Record<JobAction, string> = {
  pause: '一時停止',
  resume: '再開',
  cancel: 'キャンセル',
  prioritize: '優先実行',
}

const ACTION_ICONS: Record<JobAction, string> = {
  pause: 'mdi-pause',
  resume: 'mdi-play',
  cancel: 'mdi-close',
  prioritize: 'mdi-chevron-double-up',
}

async function onAction(entry: JobListEntry, action: JobAction) {
  // キャンセルは取り返しがつかないため確認を挟む
  if (action === 'cancel' && !window.confirm(`ジョブ ${entry.jobId} をキャンセルしますか？（元に戻せません）`)) {
    return
  }

  pendingAction.value = `${entry.jobId}:${action}`
  actionMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await requestJobAction(entry.jobId, action, getJobToken(entry.jobId))
    // pause/cancel は即座に反映されず pausing/cancelling の中間状態を経る。
    // サーバーのメッセージをそのまま出して「今のファイル完了後に…」を伝える。
    const message = result.message || `${ACTION_LABELS[action]}を受け付けました。`
    actionMessage.value = message
    toast.success(`${ACTION_LABELS[action]}を受け付けました`, entry.jobId)
  } catch (err) {
    const message = toReadableMessage(err, '時間を置いて再度お試しください。')
    errorMessage.value = message
    toast.error(`${ACTION_LABELS[action]}に失敗しました`, message)
  } finally {
    pendingAction.value = null
    await refresh()
  }
}

// トークンで操作(モックの queue-access に相当)。
// 事前にトークンの正誤を検証する専用APIは無いため、実際に軽量な操作(pause→resumeなど)を
// 試すのではなく、まずトークンを保持させてから通常の操作ボタンを使ってもらう形にする。
// サーバーがトークン不一致を 401/403 で返した場合はエラー表示し、保存を取り消す。
const tokenDialogJobId = ref<string | null>(null)
const tokenInput = ref('')
const tokenVerifying = ref(false)
const tokenError = ref('')

const tokenDialogEntry = computed(() =>
  tokenDialogJobId.value ? jobs.value.find((j) => j.jobId === tokenDialogJobId.value) ?? null : null,
)

function openTokenDialog(jobId: string) {
  tokenDialogJobId.value = jobId
  tokenInput.value = ''
  tokenError.value = ''
}

function closeTokenDialog() {
  tokenDialogJobId.value = null
}

function openResult(jobId: string) {
  closeTokenDialog()
  emit('open-result', jobId)
}

async function verifyToken() {
  if (tokenVerifying.value) return // Enter連打やダブルクリックによる多重実行を防ぐ

  const jobId = tokenDialogJobId.value
  if (!jobId || !tokenInput.value.trim()) return

  tokenVerifying.value = true
  tokenError.value = ''
  const candidate = tokenInput.value.trim()
  try {
    // ジョブ詳細取得(GET)は状態を変えない副作用フリーの操作なので、
    // トークンの正誤確認に使う。誤りなら 401 でエラーになる。
    //
    // 注意: jobDetailAuthRequired と jobControlAuthRequired はバックエンド側で独立したフラグ。
    // jobDetailAuthRequired=false の構成では、詳細取得はどんな文字列を渡しても成功してしまうため、
    // 「詳細取得が成功した」という事実だけでは、渡したトークンが実際に正しい(操作権限がある)
    // ことを確定できない。事前にトークンの正誤だけを検証する専用APIは無い。
    await fetchJobStatusById(jobId, candidate)

    if (authRequirements.value?.jobDetailAuthRequired) {
      // 詳細取得自体に認証が必要な構成なら、成功した時点でトークンが正しいと確定できる。
      rememberJobToken(jobId, candidate)
    } else {
      // 詳細取得に認証が不要な構成では、上記の成功はトークンの正誤を保証しない。
      // ここでは「他人のジョブが自分のタスクと誤認される」安全側の最善策として、
      // 一旦トークンは保持しつつ(=操作ボタンを表示させ、利用者が実際に操作を試せるようにする)、
      // 実際の正誤は operation(pause/resume/cancel等)実行時のサーバー応答(401/403)で
      // 初めて確定する。onAction() 側で失敗時にエラー表示される。
      rememberJobToken(jobId, candidate)
    }
    closeTokenDialog()
    await refresh()
  } catch (err) {
    tokenError.value = 'トークンが一致しません。'
  } finally {
    tokenVerifying.value = false
  }
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await fetchJobList()
    jobs.value = result.jobs
    authRequirements.value = result.authRequirements
    loadedOnce.value = true
    // 一覧に無い(期限切れで消えた)ジョブのトークンを掃除する
    pruneJobTokens(result.jobs.map((j) => j.jobId))
  } catch (err) {
    errorMessage.value = toReadableMessage(err, 'ジョブ一覧の取得に失敗しました。時間を置いて再度お試しください。')
  } finally {
    loading.value = false
    autoRefreshCountdown.value = AUTO_REFRESH_SECONDS
  }
}

// モックの advanceQueue(showMessage=true) に相当。「今すぐ更新」押下時のみ結果をトーストで知らせる
// (自動更新では出さない)。
async function onManualRefresh() {
  autoRefreshCountdown.value = AUTO_REFRESH_SECONDS
  await refresh()
  if (!errorMessage.value) {
    toast.success('キューを更新しました', '最新の処理状況を取得しました')
  }
}

// モックの setInterval(…,1000) と同じく、ジョブの有無に関わらず1秒ごとに減算し、0で自動更新する
function tickCountdown() {
  if (loading.value) return
  autoRefreshCountdown.value -= 1
  if (autoRefreshCountdown.value <= 0) void refresh()
}

onMounted(() => {
  void refresh()
  countdownTimer = setInterval(tickCountdown, 1000)
})
onBeforeUnmount(() => {
  if (countdownTimer !== null) clearInterval(countdownTimer)
})

defineExpose({ refresh })
</script>

<template>
  <div class="content">
    <div class="page-intro">
      <div>
        <h2>作業キュー</h2>
        <p>タスクは上から順に1件ずつ処理されます。ファイル名や画像などの中身は、トークンを持つ人にだけ表示されます。</p>
      </div>
      <div class="page-intro-actions">
        <v-btn-toggle
          v-model="scope"
          density="comfortable"
          variant="outlined"
          divided
          mandatory
          color="primary"
        >
          <v-btn value="everyone" size="small">全員</v-btn>
          <v-btn value="ownOnly" size="small">自分のみ</v-btn>
        </v-btn-toggle>
        <span class="badge success">
          <span class="status-dot" />
          自動更新 {{ autoRefreshCountdown }}秒
        </span>
        <button class="btn outline" :disabled="loading" @click="onManualRefresh">
          <v-icon icon="mdi-refresh" size="16" />
          今すぐ更新
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="alert danger">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span class="alert-text" :title="errorMessage">{{ errorMessage }}</span>
    </p>

    <p v-if="actionMessage" class="alert info">
      <v-icon icon="mdi-information-outline" size="18" />
      <span class="alert-text" :title="actionMessage">{{ actionMessage }}</span>
    </p>

    <div class="queue-strip">
      <div class="queue-strip-item">
        <span class="queue-strip-icon run"><v-icon icon="mdi-play" size="20" /></span>
        <div>
          <span>処理中</span>
          <strong>{{ processingCount }} 件</strong>
        </div>
      </div>
      <div class="queue-strip-item">
        <span class="queue-strip-icon wait"><v-icon icon="mdi-clock-outline" size="20" /></span>
        <div>
          <span>処理待ち</span>
          <strong>{{ waitingCount }} 件</strong>
        </div>
      </div>
      <div class="queue-strip-item">
        <span class="queue-strip-icon pause"><v-icon icon="mdi-pause" size="20" /></span>
        <div>
          <span>一時停止</span>
          <strong>{{ pausedCount }} 件</strong>
        </div>
      </div>
    </div>

    <p v-if="loadedOnce && visibleJobs.length === 0 && !errorMessage" class="mk-muted empty-note">
      {{ scope === 'ownOnly' ? '自分のジョブはありません。' : 'ジョブはありません。' }}
    </p>

    <div v-else class="queue-list">
      <article
        v-for="entry in visibleJobs"
        :key="entry.jobId"
        class="queue-card"
        :class="`st-${entry.status}`"
      >
        <span v-if="isOwnJob(entry.jobId)" class="queue-own">自分のタスク</span>

        <div class="queue-pos" :class="positionLabel(entry).cls">
          <span class="pos-main" :class="{ small: positionLabel(entry).main.length > 3 }">
            {{ positionLabel(entry).main }}
          </span>
          <span class="pos-sub">{{ positionLabel(entry).sub }}</span>
        </div>

        <div class="queue-main">
          <div class="row wrap">
            <span class="queue-id">{{ entry.jobId }}</span>
            <v-chip size="small" variant="tonal">{{ STATUS_LABELS[entry.status] }}</v-chip>
            <v-chip v-if="entry.executionParameters" size="small" :color="entryDidMask(entry) ? 'primary' : 'info'" variant="tonal">
              <v-icon :icon="entryDidMask(entry) ? 'mdi-drama-masks' : 'mdi-eye-outline'" size="14" start />
              {{ entryDidMask(entry) ? 'チェック＋マスク' : 'チェックのみ' }}
            </v-chip>
          </div>
          <div class="queue-sub">
            受付 {{ formatDate(entry.startDate) }} ·
            {{ entry.uploadedFiles.total ?? '—' }}ファイル /
            {{ entry.extractedImages.total ?? '—' }}画像
          </div>

          <div class="queue-progress-slot">
            <div
              v-if="entry.status === 'running' || entry.status === 'paused' || entry.status === 'pausing' || entry.status === 'cancelling'"
              class="queue-progress"
            >
              <div class="progress" :class="{ warning: entry.status !== 'running' }">
                <span :style="{ width: `${progressPercent(entry)}%` }" />
              </div>
              <div class="progress-meta">
                <span>
                  {{ entry.status === 'running' ? '処理を実行しています'
                    : entry.status === 'cancelling' ? 'キャンセル処理中です'
                    : '一時停止中' }}
                  （{{ processedCount(entry) }} / {{ entry.extractedImages.total ?? '—' }}画像）
                </span>
                <strong>{{ progressPercent(entry) }}%</strong>
              </div>
            </div>
            <div v-else-if="entry.status === 'queued'" class="queue-placeholder">
              <v-icon icon="mdi-clock-outline" size="16" />
              <span>
                <strong>{{ queuedJobIds.indexOf(entry.jobId) === 0 ? '次に実行' : `前に${queuedJobIds.indexOf(entry.jobId)}件` }}</strong>
                · 前のタスク完了後に自動で開始します
              </span>
            </div>
            <div v-else-if="entry.status === 'completed'" class="queue-progress">
              <div class="progress success"><span style="width: 100%" /></div>
              <div class="progress-meta">
                <span>{{ entry.extractedImages.total ?? processedCount(entry) }}画像を処理済み</span>
                <strong>100%</strong>
              </div>
            </div>
            <div v-else class="queue-placeholder">
              <v-icon icon="mdi-stop" size="16" />
              <span><strong>処理を中止しました</strong> · 完了済み分は結果画面から確認できます</span>
            </div>
          </div>
        </div>

        <div class="queue-actions">
          <template v-if="availableActions(entry).length > 0 && canControl(entry.jobId)">
            <button
              v-for="action in availableActions(entry)"
              :key="action"
              class="btn outline small"
              :disabled="pendingAction !== null"
              @click="onAction(entry, action)"
            >
              <v-progress-circular v-if="pendingAction === `${entry.jobId}:${action}`" indeterminate size="14" width="2" />
              <v-icon v-else :icon="ACTION_ICONS[action]" size="14" />
              {{ ACTION_LABELS[action] }}
            </button>
          </template>
          <button v-else class="btn outline small" @click="openTokenDialog(entry.jobId)">
            <v-icon :icon="isOwnJob(entry.jobId) ? 'mdi-dots-horizontal' : 'mdi-key-outline'" size="14" />
            {{ isOwnJob(entry.jobId) ? '操作する' : 'トークンで操作' }}
          </button>
          <div class="expiry">
            <v-icon icon="mdi-calendar-outline" size="13" />
            <span>
              {{ isExpired(entry.expiryDate) ? '期限切れ' : `保持期限 ${formatDate(entry.expiryDate)}` }}
              <template v-if="!isExpired(entry.expiryDate) && isExpirySoon(entry.expiryDate)">
                （残り{{ getDaysUntilExpiry(entry.expiryDate) }}日）
              </template>
            </span>
          </div>
        </div>
      </article>
    </div>

    <div class="queue-note">
      <v-icon icon="mdi-key-outline" size="15" />
      <span>キャンセル・一時停止・再開・優先実行には、タスク登録時に発行されたトークンが必要です。</span>
    </div>

    <!-- トークンでタスクを開く(モックの queue-access モーダルに相当) -->
    <v-dialog :model-value="tokenDialogJobId !== null" max-width="420" @update:model-value="(v) => !v && closeTokenDialog()">
      <v-card v-if="tokenDialogJobId && tokenDialogEntry" rounded="lg">
        <!-- 認証済み(自分のジョブ): 状態要約 + 完了なら結果への導線 -->
        <template v-if="isOwnJob(tokenDialogJobId)">
          <v-card-title class="dialog-title">
            タスクを操作
            <div class="dialog-subtitle">{{ tokenDialogJobId }}</div>
          </v-card-title>
          <v-card-text class="stack tight">
            <div class="row between">
              <v-chip size="small" variant="tonal">{{ STATUS_LABELS[tokenDialogEntry.status] }}</v-chip>
              <v-chip size="small" color="success" variant="tonal">
                <v-icon icon="mdi-key-outline" size="13" start />
                認証済み
              </v-chip>
            </div>
            <div class="dialog-brief">
              <span>ファイル <strong>{{ tokenDialogEntry.uploadedFiles.total ?? '—' }}件</strong></span>
              <span>画像 <strong>{{ tokenDialogEntry.extractedImages.total ?? '—' }}枚</strong></span>
              <span>進捗 <strong>{{ progressPercent(tokenDialogEntry) }}%</strong></span>
              <span v-if="tokenDialogEntry.executionParameters">
                {{ entryDidMask(tokenDialogEntry) ? 'チェック＋マスク' : 'チェックのみ' }}
              </span>
            </div>
            <template v-if="availableActions(tokenDialogEntry).length > 0">
              <button
                v-for="action in availableActions(tokenDialogEntry)"
                :key="action"
                class="btn outline block"
                :disabled="pendingAction !== null"
                @click="onAction(tokenDialogEntry, action); closeTokenDialog()"
              >
                <v-icon :icon="ACTION_ICONS[action]" size="14" />
                {{ ACTION_LABELS[action] }}
              </button>
            </template>
            <button
              v-else-if="['completed', 'failed', 'cancelled'].includes(tokenDialogEntry.status)"
              class="btn primary block"
              @click="openResult(tokenDialogJobId)"
            >
              <v-icon icon="mdi-file-document-outline" size="14" />
              結果を開く
            </button>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="outlined" @click="closeTokenDialog">閉じる</v-btn>
          </v-card-actions>
        </template>

        <!-- 未認証: トークン入力 -->
        <template v-else>
          <v-card-title class="dialog-title">
            トークンでタスクを開く
            <div class="dialog-subtitle">{{ tokenDialogJobId }}</div>
          </v-card-title>
          <v-card-text class="stack tight">
            <div class="alert info">
              <v-icon icon="mdi-lock-outline" size="18" />
              <div>このタスクの操作には、登録時に発行されたトークンが必要です。</div>
            </div>
            <v-text-field
              v-model="tokenInput"
              label="タスクトークン"
              density="comfortable"
              autofocus
              :error="!!tokenError"
              :error-messages="tokenError ? [tokenError] : []"
              @keyup.enter="verifyToken"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="outlined" @click="closeTokenDialog">キャンセル</v-btn>
            <v-btn color="primary" variant="flat" :loading="tokenVerifying" :disabled="!tokenInput.trim() || tokenVerifying" @click="verifyToken">
              確認
            </v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.page-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
  flex-wrap: wrap;
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

.page-intro-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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
  white-space: nowrap;
}

.badge.success {
  color: #148055;
  background: #e4f6ee;
  border-color: #ccebdd;
}

.badge .status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #148055;
  box-shadow: none;
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
  color: var(--mk-muted);
  font-size: 12.5px;
  font-weight: 400;
}

.alert {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  margin-bottom: 12px;
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

.empty-note {
  padding: 2rem 0;
  text-align: center;
}

.queue-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.queue-strip-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--mk-border);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
}

.queue-strip-icon {
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 13px;
}

.queue-strip-icon.run {
  color: var(--mk-primary);
  background: rgba(0, 123, 167, .08);
}

.queue-strip-icon.wait {
  color: var(--mk-muted);
  background: #f0f3f8;
}

.queue-strip-icon.pause {
  color: #a96407;
  background: #fff3dd;
}

.queue-strip-item > div > span {
  display: block;
  color: var(--mk-muted);
  font-size: 13px;
  font-weight: 700;
}

.queue-strip-item strong {
  display: block;
  font-size: 26px;
  line-height: 1.15;
  letter-spacing: -.02em;
}

.queue-list {
  display: grid;
  gap: 14px;
}

.queue-card {
  position: relative;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  padding: 18px 20px 18px 24px;
  border: 1px solid var(--mk-border);
  border-left-width: 0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
  overflow: hidden;
}

.queue-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  background: #c9d4e3;
}

.queue-card.st-running::before {
  background: var(--mk-primary);
}

.queue-card.st-queued::before {
  background: #b9c4d6;
}

.queue-card.st-paused::before,
.queue-card.st-pausing::before {
  background: #e3a83a;
}

.queue-card.st-completed::before {
  background: #2aa876;
}

.queue-card.st-cancelled::before,
.queue-card.st-failed::before {
  background: #c73f4b;
}

.queue-card.st-running {
  border-color: #c4d3f4;
  background: linear-gradient(90deg, #f7faff, #fff 42%);
}

.queue-pos {
  text-align: center;
}

.queue-pos .pos-main {
  display: block;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -.02em;
  line-height: 1.2;
}

.queue-pos .pos-main.small {
  font-size: 16px;
}

.queue-pos .pos-sub {
  display: block;
  margin-top: 2px;
  color: #8892a3;
  font-size: 12px;
  font-weight: 700;
}

.queue-pos.run .pos-main {
  color: var(--mk-primary);
}

.queue-main {
  min-width: 0;
}

.queue-id {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -.01em;
}

.queue-sub {
  margin-top: 4px;
  color: var(--mk-muted);
  font-size: 13px;
}

.queue-progress {
  margin-top: 12px;
  max-width: 520px;
}

.queue-own {
  position: absolute;
  right: 20px;
  top: -1px;
  padding: 3px 12px 4px;
  border-radius: 0 0 9px 9px;
  background: var(--mk-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .04em;
}

.queue-note {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #8892a3;
  font-size: 12.5px;
}

.progress {
  height: 8px;
  overflow: hidden;
  border-radius: 99px;
  background: #e7ebf1;
}

.progress > span {
  display: block;
  height: 100%;
  width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #436bd7, #6687e7);
  transition: width .35s ease;
}

.progress.success > span {
  background: linear-gradient(90deg, #159171, #2fb795);
}

.progress.warning > span {
  background: linear-gradient(90deg, #c17b1c, #dda74e);
}

.progress-meta {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  color: var(--mk-muted);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.progress-meta strong {
  color: var(--mk-text);
}

.queue-placeholder {
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--mk-border);
  border-radius: 10px;
  background: #f8fafc;
  color: var(--mk-muted);
  font-size: 13px;
}

.queue-placeholder strong {
  color: var(--mk-text);
}

.queue-actions {
  align-self: center;
  display: grid;
  gap: 8px;
  justify-items: end;
}

.no-permission {
  font-size: 12.5px;
}

.expiry {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8892a3;
  font-size: 12px;
  white-space: nowrap;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row.wrap {
  flex-wrap: wrap;
}

.row.between {
  justify-content: space-between;
}

.dialog-brief {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--mk-muted);
  font-size: 13px;
}

.dialog-brief strong {
  color: var(--mk-text);
}

.dialog-note {
  margin: 0;
  font-size: 13px;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  min-height: 42px;
  padding: 9px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 10px;
  background: #fff;
  color: var(--mk-text);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}

.btn.block {
  width: 100%;
}

.btn:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.btn.outline {
  border-color: var(--mk-border);
  background: #fff;
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

.btn.small {
  min-height: 35px;
  padding: 7px 12px;
  font-size: 13px;
  border-radius: 9px;
}

@media (max-width: 1120px) {
  .queue-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .queue-card {
    grid-template-columns: 84px minmax(0, 1fr);
  }
  .queue-actions {
    grid-column: 2;
    justify-self: end;
  }
}
</style>
