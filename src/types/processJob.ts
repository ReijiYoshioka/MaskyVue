// user-api の /file-processing-jobs 系レスポンスの型定義。
// 参照: FaceMask/user-api/README.md, MaskyFlutter/lib/models/process_job.dart

export type ProcessJobStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'cancelling'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export const TERMINAL_STATUSES: readonly ProcessJobStatus[] = ['completed', 'failed', 'cancelled']

export interface FileCounts {
  total: number | null
  completed: number
  failed: number
}

export interface AuthRequirements {
  jobDetailAuthRequired: boolean
  jobControlAuthRequired: boolean
  downloadAuthRequired: boolean
  detectionStatsAuthRequired: boolean
}

export interface PollingUrls {
  hybrid: string
  counts: string
  filenames: string
}

export interface GeneratedFileResource {
  displayName: string
  downloadName: string
  mediaType: string
  url: string
  expiresAt: string | null
}

export interface ProcessedImageFileResult {
  displayName: string
  downloadName: string | null
  mediaType: string | null
  url: string | null
  expiresAt: string | null
  detectedFaceCount: number | null
  faceTimeSeconds: number | null
  detectedTextCount: number | null
  textTimeSeconds: number | null
  thumbnail: GeneratedFileResource | null
  error: string | null
}

export interface JobSubmissionResponse {
  jobId: string
  token: string
  uploadedFiles: FileCounts
  authRequirements: AuthRequirements | null
  pollingUrls: PollingUrls
  expiresAt: string | null
}

export interface JobStatusResponse {
  status: ProcessJobStatus
  uploadedFiles: FileCounts
  extractedImages: FileCounts
  authRequirements: AuthRequirements | null
  resultFile: GeneratedFileResource | null
  files: ProcessedImageFileResult[]
  error: { errorId: string; message: string } | null
  message: string | null
}

type Json = Record<string, unknown>

function asJson(value: unknown, context: string): Json {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${context} が JSON オブジェクトではありません。`)
  }
  return value as Json
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function parseFileCounts(value: unknown, objectName: string): FileCounts {
  const json = asJson(value, objectName)
  const completed = asNumber(json.completed)
  const failed = asNumber(json.failed)
  if (completed === null || failed === null) {
    throw new Error(`${objectName} に completed/failed がありません。`)
  }
  return { total: asNumber(json.total), completed, failed }
}

function parseAuthRequirements(metadata: unknown): AuthRequirements | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const authJson = (metadata as Json).auth_requirements
  if (typeof authJson !== 'object' || authJson === null) return null
  const a = authJson as Json
  return {
    jobDetailAuthRequired: a.job_detail_auth_required === true,
    jobControlAuthRequired: a.job_control_auth_required === true,
    downloadAuthRequired: a.download_auth_required === true,
    detectionStatsAuthRequired: a.detection_stats_auth_required === true,
  }
}

function parsePollingUrls(value: unknown): PollingUrls {
  const json = asJson(value, 'polling_urls')
  const hybrid = asString(json.hybrid)
  const counts = asString(json.counts)
  const filenames = asString(json.filenames)
  if (hybrid === null || counts === null || filenames === null) {
    throw new Error('polling_urls に hybrid/counts/filenames がありません。')
  }
  return { hybrid, counts, filenames }
}

function parseGeneratedFileResource(value: unknown): GeneratedFileResource | null {
  if (typeof value !== 'object' || value === null) return null
  const json = value as Json
  const displayName = asString(json.display_name)
  const downloadName = asString(json.download_name)
  const mediaType = asString(json.media_type)
  const url = asString(json.url)
  if (displayName === null || downloadName === null || mediaType === null || url === null) {
    return null
  }
  return { displayName, downloadName, mediaType, url, expiresAt: asString(json.expires_at) }
}

function parseProcessedImageFileResult(value: unknown): ProcessedImageFileResult {
  const json = asJson(value, 'files[]')
  const displayName = asString(json.display_name)
  if (displayName === null) {
    throw new Error('files[] に display_name がありません。')
  }
  return {
    displayName,
    downloadName: asString(json.download_name),
    mediaType: asString(json.media_type),
    url: asString(json.url),
    expiresAt: asString(json.expires_at),
    detectedFaceCount: asNumber(json.detected_face_count),
    faceTimeSeconds: asNumber(json.face_time_seconds),
    detectedTextCount: asNumber(json.detected_text_count),
    textTimeSeconds: asNumber(json.text_time_seconds),
    thumbnail: parseGeneratedFileResource(json.thumbnail),
    error: asString(json.error),
  }
}

export function parseJobSubmissionResponse(value: unknown): JobSubmissionResponse {
  const json = asJson(value, 'job submission response')
  const jobId = asString(json.job_id)
  const token = asString(json.token)
  if (jobId === null || !jobId) throw new Error('レスポンスに job_id がありません。')
  if (token === null || !token) throw new Error('レスポンスに token がありません。')

  return {
    jobId,
    token,
    uploadedFiles: parseFileCounts(json.uploaded_files, 'uploaded_files'),
    authRequirements: parseAuthRequirements(json.metadata),
    pollingUrls: parsePollingUrls(json.polling_urls),
    expiresAt: asString(json.expires_at),
  }
}

export function parseJobStatusResponse(value: unknown): JobStatusResponse {
  const json = asJson(value, 'job status response')
  const status = asString(json.status)
  if (status === null) throw new Error('レスポンスに status がありません。')

  const filesJson = json.files
  const files = Array.isArray(filesJson) ? filesJson.map(parseProcessedImageFileResult) : []

  const errorJson = json.error
  const error =
    typeof errorJson === 'object' && errorJson !== null
      ? {
          errorId: asString((errorJson as Json).error_id) ?? 'unknown_error',
          message: asString((errorJson as Json).message) ?? '',
        }
      : null

  return {
    status: status as ProcessJobStatus,
    uploadedFiles: parseFileCounts(json.uploaded_files, 'uploaded_files'),
    extractedImages: parseFileCounts(json.extracted_images, 'extracted_images'),
    authRequirements: parseAuthRequirements(json.metadata),
    resultFile: parseGeneratedFileResource(json.result_file),
    files,
    error,
    message: asString(json.message),
  }
}

/** -1 はタスク失敗のセンチネル値。null 化して「未取得/失敗」を表す。 */
export function normalizeMetric(value: number | null): number | null {
  if (value === null || value < 0) return null
  return value
}
