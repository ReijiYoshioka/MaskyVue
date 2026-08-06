import { onBeforeUnmount, ref } from 'vue'
import { toReadableMessage } from '@/api/http'
import { fetchJobStatus, submitProcessingJob, type ProcessImageOptions } from '@/api/userApi'
import { rememberJobToken } from '@/state/jobTokenStore'
import {
  TERMINAL_STATUSES,
  type JobStatusResponse,
  type JobSubmissionResponse,
  type ProcessJobStatus,
} from '@/types/processJob'

const POLL_INTERVAL_MS = 1500

export type FlowPhase = 'idle' | 'uploading' | 'polling' | 'completed' | 'failed' | 'error'

/** タスクは1回のアップロード(複数ファイル可)につき1件。結果の詳細確認は
 *  ResultExplorer(タスク→アップロードファイル→画像のドリルダウン)が担う。 */
export function useProcessImage() {
  const phase = ref<FlowPhase>('idle')
  const errorMessage = ref('')
  const job = ref<JobSubmissionResponse | null>(null)
  const jobStatus = ref<JobStatusResponse | null>(null)
  // アップロード時にクライアントが保持していた元ファイル群。zip/PDF/Office 展開後の
  // 個別画像には対応する元画像が取れないため、単一画像アップロード時の before 表示にのみ使う。
  const uploadedFiles = ref<File[]>([])

  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function reset() {
    clearPollTimer()
    phase.value = 'idle'
    errorMessage.value = ''
    job.value = null
    jobStatus.value = null
    uploadedFiles.value = []
  }

  async function pollOnce(currentJob: JobSubmissionResponse) {
    try {
      const status = await fetchJobStatus(currentJob.pollingUrls.hybrid, currentJob.token)
      jobStatus.value = status

      if (isTerminal(status.status)) {
        clearPollTimer()
        phase.value = status.status === 'completed' ? 'completed' : 'failed'
        if (status.status !== 'completed') {
          errorMessage.value = status.error?.message ?? `ジョブが ${status.status} で終了しました。`
        }
        return
      }

      pollTimer = setTimeout(() => void pollOnce(currentJob), POLL_INTERVAL_MS)
    } catch (err) {
      clearPollTimer()
      phase.value = 'error'
      errorMessage.value = toReadableMessage(err, '処理状況の確認に失敗しました。時間を置いて再度お試しください。')
    }
  }

  async function submit(files: File[], options: ProcessImageOptions) {
    reset()
    uploadedFiles.value = files
    phase.value = 'uploading'
    try {
      const submitted = await submitProcessingJob(files, options)
      rememberJobToken(submitted.jobId, submitted.token)
      job.value = submitted
      phase.value = 'polling'
      await pollOnce(submitted)
    } catch (err) {
      phase.value = 'error'
      errorMessage.value = toReadableMessage(err, 'タスクの登録に失敗しました。時間を置いて再度お試しください。')
    }
  }

  onBeforeUnmount(() => {
    clearPollTimer()
  })

  return {
    phase,
    errorMessage,
    job,
    jobStatus,
    uploadedFiles,
    submit,
    reset,
  }
}

function isTerminal(status: ProcessJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
