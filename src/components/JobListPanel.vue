<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchJobList, requestJobAction, type JobAction } from '@/api/userApi'
import { getJobToken } from '@/state/jobTokenStore'
import type { AuthRequirements, JobListEntry, ProcessJobStatus } from '@/types/processJob'

// running/queued 等の動いているジョブがある間だけ自動更新する
const AUTO_REFRESH_MS = 3000

const jobs = ref<JobListEntry[]>([])
const authRequirements = ref<AuthRequirements | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const actionMessage = ref('')
const loadedOnce = ref(false)
const pendingAction = ref<string | null>(null) // `${jobId}:${action}` 実行中の操作

// 表示スコープ: 全員のジョブ / 自分のジョブのみ（Flutter版の「全員/自分のみ」に合わせる）
type JobsScope = 'everyone' | 'ownOnly'
const scope = ref<JobsScope>('everyone')

let refreshTimer: ReturnType<typeof setTimeout> | null = null

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

// DESIGN.md「Colors」: 状態はテキスト+色の両方で区別する
const STATUS_COLORS: Record<ProcessJobStatus, string> = {
  queued: 'secondary',
  running: 'primary',
  pausing: 'warning',
  cancelling: 'warning',
  paused: 'secondary',
  completed: 'success',
  failed: 'error',
  cancelled: 'secondary',
}

const hasActiveJobs = computed(() =>
  jobs.value.some((j) => !['completed', 'failed', 'cancelled'].includes(j.status)),
)

// 「自分のみ」選択時は、トークンを保持している自分のジョブだけに絞る
const visibleJobs = computed(() =>
  scope.value === 'ownOnly' ? jobs.value.filter((j) => isOwnJob(j.jobId)) : jobs.value,
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

function progressText(entry: JobListEntry): string {
  const total = entry.extractedImages.total
  const done = entry.extractedImages.completed + entry.extractedImages.failed
  if (total === null) return '展開中…'
  return `${done} / ${total}`
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
  prioritize: '優先',
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
    actionMessage.value = result.message || `${ACTION_LABELS[action]}を受け付けました。`
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    pendingAction.value = null
    await refresh()
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
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
    scheduleRefresh()
  }
}

function scheduleRefresh() {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
  if (!hasActiveJobs.value) return
  refreshTimer = setTimeout(() => void refresh(), AUTO_REFRESH_MS)
}

onMounted(() => void refresh())
onBeforeUnmount(() => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
})

defineExpose({ refresh })
</script>

<template>
  <div class="job-list">
      <div class="job-list__header">
        <p class="mk-section-title">ジョブ一覧</p>
        <div class="job-list__header-controls">
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
          <v-btn
            density="comfortable"
            variant="text"
            color="secondary"
            :loading="loading"
            @click="refresh"
          >
            <v-icon icon="mdi-refresh" start />
            更新
          </v-btn>
        </div>
      </div>

      <p v-if="errorMessage" class="job-list__notice job-list__notice--error">
        <v-icon icon="mdi-alert-circle" size="18" />
        {{ errorMessage }}
      </p>

      <p v-if="actionMessage" class="job-list__notice job-list__notice--info">
        <v-icon icon="mdi-information-outline" size="18" />
        {{ actionMessage }}
      </p>

      <p v-if="loadedOnce && visibleJobs.length === 0 && !errorMessage" class="mk-muted job-list__empty">
        {{ scope === 'ownOnly' ? '自分のジョブはありません。' : 'ジョブはありません。' }}
      </p>

      <v-table v-else-if="visibleJobs.length > 0" density="comfortable" class="job-list__table">
        <thead>
          <tr>
            <th>アクセス</th>
            <th>状態</th>
            <th>受付日時</th>
            <th>有効期限</th>
            <th>進捗（画像）</th>
            <th>検知数（目 / 文字列）</th>
            <th class="job-list__actions-head">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in visibleJobs" :key="job.jobId">
            <td>
              <v-chip
                :color="isOwnJob(job.jobId) ? 'primary' : 'secondary'"
                :variant="isOwnJob(job.jobId) ? 'flat' : 'outlined'"
                size="small"
              >
                {{ isOwnJob(job.jobId) ? '自分' : '他人' }}
              </v-chip>
            </td>
            <td>
              <v-chip :color="STATUS_COLORS[job.status]" size="small" variant="tonal">
                {{ STATUS_LABELS[job.status] ?? job.status }}
              </v-chip>
            </td>
            <td>{{ formatDate(job.startDate) }}</td>
            <td>
              <div class="job-list__expiry">
                <span>{{ formatDate(job.expiryDate) }}</span>
                <v-chip
                  v-if="!isExpired(job.expiryDate)"
                  :class="{ 'job-list__expiry-chip--soon': isExpirySoon(job.expiryDate) }"
                  :color="isExpirySoon(job.expiryDate) ? undefined : 'info'"
                  size="x-small"
                  :variant="isExpirySoon(job.expiryDate) ? 'flat' : 'tonal'"
                >
                  {{ getDaysUntilExpiry(job.expiryDate) ?? 0 }}日後
                </v-chip>
                <v-chip v-else color="error" size="x-small" variant="flat">
                  期限切れ
                </v-chip>
              </div>
            </td>
            <td>{{ progressText(job) }}</td>
            <td>
              {{ job.detectionStats ? `${job.detectionStats.detectedFaceCount} / ${job.detectionStats.detectedTextCount}` : '—' }}
            </td>
            <td class="job-list__actions">
              <template v-if="availableActions(job).length > 0 && canControl(job.jobId)">
                <v-btn
                  v-for="action in availableActions(job)"
                  :key="action"
                  size="small"
                  density="comfortable"
                  variant="text"
                  :color="action === 'cancel' ? 'error' : 'secondary'"
                  :loading="pendingAction === `${job.jobId}:${action}`"
                  :disabled="pendingAction !== null"
                  @click="onAction(job, action)"
                >
                  <v-icon :icon="ACTION_ICONS[action]" start />
                  {{ ACTION_LABELS[action] }}
                </v-btn>
              </template>
              <span v-else-if="availableActions(job).length > 0" class="mk-muted job-list__no-permission">
                操作権限なし
              </span>
            </td>
          </tr>
        </tbody>
      </v-table>
  </div>
</template>

<style scoped>
.job-list {
  width: 100%;
}

.job-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.job-list__header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.job-list__notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  padding: 1rem 1.05rem;
  border-radius: var(--mk-rounded-md);
}

.job-list__notice--error {
  background: rgba(196, 71, 71, 0.08);
  color: var(--mk-error);
}

.job-list__notice--info {
  background: rgba(0, 123, 167, 0.06);
  color: var(--mk-primary);
}

.job-list__empty {
  margin: 0.75rem 0 0;
}

.job-list__table {
  background: transparent;
  width: 100%;
  table-layout: auto;
}

.job-list__actions {
  white-space: nowrap;
  padding: 0.5rem;
}

.job-list__actions-head {
  min-width: 200px;
}

.job-list__no-permission {
  font-size: 0.8rem;
}

.job-list__expiry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* 期限間近(7日未満)の警告表示。淡黄(warning)は白地の表上で視認性が低いため、
   濃色背景+白文字で強調する(DESIGN.md「warning色を単独の判断材料にしない」に対応)。 */
.job-list__expiry-chip--soon :deep(.v-chip__underlay),
.job-list__expiry-chip--soon {
  background-color: var(--mk-expiry-soon-bg) !important;
  color: var(--mk-expiry-soon-text) !important;
}
</style>
