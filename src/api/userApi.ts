import { requestBlob, requestJson, resolveApiUrl } from './http'
import {
  parseJobListResponse,
  parseJobStatusResponse,
  parseJobSubmissionResponse,
  type JobListResponse,
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
 * ファイル群(1つ以上)をアップロードし、検知+マスキングジョブを登録する。1回のアップロード=1タスク。
 * 画像単体だけでなく zip・Office・PDF も送信可能(バックエンドが再帰的に展開して個別処理する)。
 * README「不正なファイルや一部失敗時の挙動」: 目・文字列のどちらか一方でも失敗すると
 * マスキング画像自体が生成されないため、片方のバックエンドが不調な間は対象を絞る必要がある。
 */
export async function submitProcessingJob(
  files: File[],
  options: ProcessImageOptions,
): Promise<JobSubmissionResponse> {
  const { targets, regex, kieKeys } = options
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

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

/** サーバー上の期限切れでない全ジョブの一覧(他ユーザーのジョブも含む)。トークン不要。 */
export async function fetchJobList(): Promise<JobListResponse> {
  const json = await requestJson('/file-processing-jobs', {
    action: 'ジョブ一覧を取得',
  })
  return parseJobListResponse(json)
}

export type JobAction = 'pause' | 'resume' | 'cancel' | 'prioritize'

export interface JobActionResult {
  status: string
  message: string
}

const JOB_ACTION_LABELS: Record<JobAction, string> = {
  pause: 'ジョブを一時停止',
  resume: 'ジョブを再開',
  cancel: 'ジョブをキャンセル',
  prioritize: 'ジョブを優先実行',
}

/**
 * ジョブ制御。token は自分のジョブなら保持しているものを送る。
 * job_control_auth_required=false のデプロイではトークン無しでも受理される。
 */
export async function requestJobAction(jobId: string, action: JobAction, token: string | null): Promise<JobActionResult> {
  const json = await requestJson(`/file-processing-jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST',
    headers: token ? { Authorization: token } : {},
    action: JOB_ACTION_LABELS[action],
  })
  const result = json as { status?: unknown; message?: unknown }
  return {
    status: typeof result.status === 'string' ? result.status : '',
    message: typeof result.message === 'string' ? result.message : '',
  }
}
