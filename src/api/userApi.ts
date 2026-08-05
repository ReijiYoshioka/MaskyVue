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

/** UIではまだ正規表現に名前を付けられないため、送信時は固定名を使う(README「regexはregex_name:regex_valueのJSONオブジェクト」)。 */
const DEFAULT_REGEX_NAME = '文字検知パターン'

export interface ProcessImageOptions {
  targets: ProcessImageTargets
  /** false の場合は検知(check)のみ行い、マスク画像は生成しない(UI/UX要件2.3「チェックのみ」)。 */
  shouldMask: boolean
  /** 文字列検知に使う正規表現。text 有効時のみ送信される */
  regex: string
}

/**
 * ファイル群(1つ以上)をアップロードし、検知+マスキングジョブを登録する。1回のアップロード=1タスク。
 * 画像単体だけでなく zip・Office・PDF も送信可能(バックエンドが再帰的に展開して個別処理する)。
 * README「不正なファイルや一部失敗時の挙動」: 目・文字列のどちらか一方でも失敗すると
 * マスキング画像自体が生成されないため、片方のバックエンドが不調な間は対象を絞る必要がある。
 *
 * regex は multipart フォームフィールドとして { 名前: 正規表現 } の JSON オブジェクトを渡す
 * 仕様に変わった(FaceMask commit 91c298e)。クエリの単純文字列では 422 invalid_parameter_combination になる。
 */
export async function submitProcessingJob(
  files: File[],
  options: ProcessImageOptions,
): Promise<JobSubmissionResponse> {
  const { targets, shouldMask, regex } = options
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  if (targets.text && regex.trim()) {
    formData.append('regex', JSON.stringify({ [DEFAULT_REGEX_NAME]: regex.trim() }))
  }

  const query = new URLSearchParams({
    face_check: String(targets.face),
    face_mask: String(targets.face && shouldMask),
    text_check: String(targets.text),
    text_mask: String(targets.text && shouldMask),
  })

  const json = await requestJson(`/file-processing-jobs?${query.toString()}`, {
    method: 'POST',
    body: formData,
    action: 'ファイルのアップロード',
  })
  return parseJobSubmissionResponse(json)
}

export async function fetchJobStatus(hybridPollingUrl: string, token: string): Promise<JobStatusResponse> {
  const json = await requestJson(hybridPollingUrl, {
    headers: { Authorization: token },
    action: 'ジョブ状態の取得',
  })
  return parseJobStatusResponse(json)
}

/** ジョブ一覧のカードから直接タスク詳細を開く用途。token は自分のジョブなら送る(無くても閲覧自体は可能)。 */
export async function fetchJobStatusById(jobId: string, token: string | null): Promise<JobStatusResponse> {
  const json = await requestJson(`/file-processing-jobs/${encodeURIComponent(jobId)}?detail=hybrid`, {
    headers: token ? { Authorization: token } : {},
    action: 'タスク詳細の取得',
  })
  return parseJobStatusResponse(json)
}

export async function fetchGeneratedFileBlob(rawUrl: string, token: string): Promise<Blob> {
  return requestBlob(rawUrl, token, '生成ファイルの取得')
}

export function generatedFileDownloadUrl(rawUrl: string): string {
  return resolveApiUrl(rawUrl)
}

/** サーバー上の期限切れでない全ジョブの一覧(他ユーザーのジョブも含む)。トークン不要。 */
export async function fetchJobList(): Promise<JobListResponse> {
  const json = await requestJson('/file-processing-jobs', {
    action: 'ジョブ一覧の取得',
  })
  return parseJobListResponse(json)
}

export type JobAction = 'pause' | 'resume' | 'cancel' | 'prioritize'

export interface JobActionResult {
  status: string
  message: string
}

const JOB_ACTION_LABELS: Record<JobAction, string> = {
  pause: 'ジョブの一時停止',
  resume: 'ジョブの再開',
  cancel: 'ジョブのキャンセル',
  prioritize: 'ジョブの優先実行',
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
