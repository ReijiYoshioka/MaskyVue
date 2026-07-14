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

/** サーバー(shared/utils/constants.py DEFAULT_REGEX)と同じ既定値 */
export const DEFAULT_TEXT_REGEX = '\\d{2,10}'

export interface ProcessImageOptions {
  targets: ProcessImageTargets
  /** 文字列検知に使う正規表現。text 有効時のみ送信される */
  regex: string
  /**
   * KIE(Key Information Extraction)の対象情報リスト。例: ['患者名', '患者の住所']
   * glm-experimental ブランチの ocrmask が受け取る想定(kie= の繰り返しクエリ)。
   * user-api 側が未対応の間は無視されるだけで害はない。
   */
  kieKeys: string[]
}

/**
 * 画像1枚をアップロードし、検知+マスキングジョブを登録する。
 * README「不正なファイルや一部失敗時の挙動」: 目・文字列のどちらか一方でも失敗すると
 * マスキング画像自体が生成されないため、片方のバックエンドが不調な間は対象を絞る必要がある。
 */
export async function submitProcessingJob(file: File, options: ProcessImageOptions): Promise<JobSubmissionResponse> {
  const { targets, regex, kieKeys } = options
  const formData = new FormData()
  formData.append('files', file)

  const query = new URLSearchParams({
    face_check: String(targets.face),
    face_mask: String(targets.face),
    text_check: String(targets.text),
    text_mask: String(targets.text),
  })
  if (targets.text && regex.trim()) {
    query.set('regex', regex.trim())
  }
  for (const key of kieKeys) {
    if (targets.text && key.trim()) {
      query.append('kie', key.trim())
    }
  }

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
