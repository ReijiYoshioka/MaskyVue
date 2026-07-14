<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchJobList } from '@/api/userApi'
import type { JobListEntry, ProcessJobStatus } from '@/types/processJob'

// running/queued 等の動いているジョブがある間だけ自動更新する
const AUTO_REFRESH_MS = 3000

const jobs = ref<JobListEntry[]>([])
const loading = ref(false)
const errorMessage = ref('')
const loadedOnce = ref(false)

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

function formatDate(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function progressText(entry: JobListEntry): string {
  const total = entry.extractedImages.total
  const done = entry.extractedImages.completed + entry.extractedImages.failed
  if (total === null) return '展開中…'
  return `${done} / ${total}`
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await fetchJobList()
    jobs.value = result.jobs
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
  <v-card class="mk-surface job-list">
    <v-card-text>
      <div class="job-list__header">
        <p class="mk-section-title">ジョブ一覧</p>
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

      <p v-if="errorMessage" class="job-list__error">
        <v-icon icon="mdi-alert-circle" size="18" />
        {{ errorMessage }}
      </p>

      <p v-else-if="loadedOnce && jobs.length === 0" class="mk-muted job-list__empty">
        ジョブはありません。
      </p>

      <v-table v-else-if="jobs.length > 0" density="comfortable" class="job-list__table">
        <thead>
          <tr>
            <th>状態</th>
            <th>受付日時</th>
            <th>進捗（画像）</th>
            <th>検知数（目 / 文字列）</th>
            <th>ジョブID</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.jobId">
            <td>
              <v-chip :color="STATUS_COLORS[job.status]" size="small" variant="tonal">
                {{ STATUS_LABELS[job.status] ?? job.status }}
              </v-chip>
            </td>
            <td>{{ formatDate(job.startDate) }}</td>
            <td>{{ progressText(job) }}</td>
            <td>
              {{ job.detectionStats ? `${job.detectionStats.detectedFaceCount} / ${job.detectionStats.detectedTextCount}` : '—' }}
            </td>
            <td class="job-list__job-id">{{ job.jobId }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.job-list {
  padding: 1.35rem;
}

.job-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.job-list__error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  padding: 1rem 1.05rem;
  border-radius: var(--mk-rounded-md);
  background: rgba(196, 71, 71, 0.08);
  color: var(--mk-error);
}

.job-list__empty {
  margin: 0.75rem 0 0;
}

.job-list__table {
  background: transparent;
}

.job-list__job-id {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--mk-muted);
}
</style>
