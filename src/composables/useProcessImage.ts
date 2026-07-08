import { onBeforeUnmount, ref } from 'vue'
import { fetchGeneratedFileBlob, fetchJobStatus, submitProcessingJob, type ProcessImageTargets } from '@/api/userApi'
import {
  TERMINAL_STATUSES,
  type JobStatusResponse,
  type JobSubmissionResponse,
  type ProcessJobStatus,
} from '@/types/processJob'

const POLL_INTERVAL_MS = 1500

export type FlowPhase = 'idle' | 'uploading' | 'polling' | 'completed' | 'failed' | 'error'

export function useProcessImage() {
  const phase = ref<FlowPhase>('idle')
  const errorMessage = ref('')
  const job = ref<JobSubmissionResponse | null>(null)
  const jobStatus = ref<JobStatusResponse | null>(null)
  const resultImageObjectUrl = ref<string | null>(null)
  const resultDownloadName = ref<string | null>(null)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let resultBlob: Blob | null = null

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function revokeResultImage() {
    if (resultImageObjectUrl.value) {
      URL.revokeObjectURL(resultImageObjectUrl.value)
      resultImageObjectUrl.value = null
    }
    resultBlob = null
    resultDownloadName.value = null
  }

  function reset() {
    clearPollTimer()
    revokeResultImage()
    phase.value = 'idle'
    errorMessage.value = ''
    job.value = null
    jobStatus.value = null
  }

  async function loadResultImage(status: JobStatusResponse, token: string) {
    // 単一ファイル送信なので files[0] が対象。url が null の場合は
    // face_failed/text_failed 等でマスキング画像が生成されなかったケース（呼び出し元でハンドリング）。
    const target = status.files[0]
    if (!target?.url) return
    try {
      const blob = await fetchGeneratedFileBlob(target.url, token)
      revokeResultImage()
      resultBlob = blob
      resultDownloadName.value = target.downloadName ?? target.displayName
      resultImageObjectUrl.value = URL.createObjectURL(blob)
    } catch (err) {
      // 画像取得に失敗してもジョブ自体は成功として扱い、エラーは黙って諦める。
      console.error('結果画像の取得に失敗しました', err)
    }
  }

  function downloadResult() {
    if (!resultBlob || !resultDownloadName.value) return
    const url = URL.createObjectURL(resultBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = resultDownloadName.value
    link.click()
    URL.revokeObjectURL(url)
  }

  async function pollOnce(currentJob: JobSubmissionResponse) {
    try {
      const status = await fetchJobStatus(currentJob.pollingUrls.hybrid, currentJob.token)
      jobStatus.value = status

      if (isTerminal(status.status)) {
        clearPollTimer()
        if (status.status === 'completed') {
          phase.value = 'completed'
          await loadResultImage(status, currentJob.token)
        } else {
          phase.value = 'failed'
          errorMessage.value = status.error?.message ?? `ジョブが ${status.status} で終了しました。`
        }
        return
      }

      pollTimer = setTimeout(() => void pollOnce(currentJob), POLL_INTERVAL_MS)
    } catch (err) {
      clearPollTimer()
      phase.value = 'error'
      errorMessage.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function submit(file: File, targets: ProcessImageTargets) {
    reset()
    phase.value = 'uploading'
    try {
      const submitted = await submitProcessingJob(file, targets)
      job.value = submitted
      phase.value = 'polling'
      await pollOnce(submitted)
    } catch (err) {
      phase.value = 'error'
      errorMessage.value = err instanceof Error ? err.message : String(err)
    }
  }

  onBeforeUnmount(() => {
    clearPollTimer()
    revokeResultImage()
  })

  return {
    phase,
    errorMessage,
    job,
    jobStatus,
    resultImageObjectUrl,
    resultDownloadName,
    submit,
    reset,
    downloadResult,
  }
}

function isTerminal(status: ProcessJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
