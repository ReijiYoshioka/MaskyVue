import { requestBlob, requestJson, resolveApiUrl } from './http'
import {
  parseJobStatusResponse,
  parseJobSubmissionResponse,
  type JobStatusResponse,
  type JobSubmissionResponse,
} from '@/types/processJob'

export interface ProcessImageTargets {
  face: boolean
  text: boolean
}

/**
 * 画像1枚をアップロードし、検知+マスキングジョブを登録する。
 * 対象を1つも選ばなかった場合はサーバー既定値（両方有効）に委ねる。
 * README「不正なファイルや一部失敗時の挙動」: 目・文字列のどちらか一方でも失敗すると
 * マスキング画像自体が生成されないため、片方のバックエンドが不調な間は対象を絞る必要がある。
 */
export async function submitProcessingJob(file: File, targets: ProcessImageTargets): Promise<JobSubmissionResponse> {
  const formData = new FormData()
  formData.append('files', file)

  const query = new URLSearchParams({
    face_check: String(targets.face),
    face_mask: String(targets.face),
    text_check: String(targets.text),
    text_mask: String(targets.text),
  })

  const json = await requestJson(`/file-processing-jobs?${query.toString()}`, {
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
