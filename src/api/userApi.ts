import { requestBlob, requestJson, resolveApiUrl } from './http'
import {
  parseJobStatusResponse,
  parseJobSubmissionResponse,
  type JobStatusResponse,
  type JobSubmissionResponse,
} from '@/types/processJob'

/**
 * 画像1枚をアップロードし、検知+マスキングジョブを登録する。
 * クエリは省略し、サーバー既定値（face/text 共に検知+マスキング有効）に委ねる。
 */
export async function submitProcessingJob(file: File): Promise<JobSubmissionResponse> {
  const formData = new FormData()
  formData.append('files', file)

  const json = await requestJson('/file-processing-jobs', {
    method: 'POST',
    body: formData,
    action: 'ファイルをアップロード',
  })
  return parseJobSubmissionResponse(json)
}

export async function fetchJobStatus(hybridPollingUrl: string, token: string): Promise<JobStatusResponse> {
  const json = await requestJson(hybridPollingUrl, {
    headers: { Authorization: token },
    action: 'ジョブ状態を取得',
  })
  return parseJobStatusResponse(json)
}

export async function fetchGeneratedFileBlob(rawUrl: string, token: string): Promise<Blob> {
  return requestBlob(rawUrl, token, '生成ファイルを取得')
}

export function generatedFileDownloadUrl(rawUrl: string): string {
  return resolveApiUrl(rawUrl)
}
