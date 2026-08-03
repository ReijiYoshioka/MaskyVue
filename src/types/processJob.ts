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

/** files[*].errors の1要素(README: location/id/日本語message)。成功時は空配列。 */
export interface ProcessedImageFileError {
  location: string
  id: string
  message: string
}

/** files[*].original (README: 保持された未マスキング元画像。専用の thumbnail を持つ)。 */
export interface OriginalFileResource extends GeneratedFileResource {
  thumbnail: GeneratedFileResource | null
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
  /** 保持された未マスキングの元画像(README: files[*].original)。無ければ null。 */
  original: OriginalFileResource | null
  errors: ProcessedImageFileError[]
}

export interface JobSubmissionResponse {
  jobId: string
  token: string
  uploadedFiles: FileCounts
  authRequirements: AuthRequirements | null
  pollingUrls: PollingUrls
  expiresAt: string | null
}

/** README: このジョブの登録時に確定した不変の実行パラメータ。regex はキー=名前、値=正規表現のOR条件。 */
export interface ExecutionParameters {
  faceCheck: boolean
  faceMask: boolean
  textCheck: boolean
  textMask: boolean
  regex: Record<string, string> | null
}

export interface JobStatusResponse {
  status: ProcessJobStatus
  executionParameters: ExecutionParameters | null
  uploadedFiles: FileCounts
  extractedImages: FileCounts
  authRequirements: AuthRequirements | null
  resultFile: GeneratedFileResource | null
  resultSummary: GeneratedFileResource | null
  files: ProcessedImageFileResult[]
  error: { errorId: string; message: string } | null
  message: string | null
  expiresAt: string | null
}

/** GET /file-processing-jobs (一覧) の1件分。
 *  「自分/他人」の判定はサーバーが返す access ではなく、
 *  クライアントが保持する jobTokenStore のトークン有無で行う(README:
 *  ユーザー単位の認証システムは存在せず、トークンの所持が唯一の判定材料)。 */
/** README: 一覧では検知統計が公開設定の場合のみ返る、regexを含まない簡略版の実行パラメータ。 */
export interface ListExecutionParameters {
  faceCheck: boolean
  faceMask: boolean
  textCheck: boolean
  textMask: boolean
}

export interface JobListEntry {
  jobId: string
  startDate: string
  expiryDate: string
  status: ProcessJobStatus
  executionParameters: ListExecutionParameters | null
  uploadedFiles: FileCounts
  extractedImages: FileCounts
  detectionStats: { detectedFaceCount: number; detectedTextCount: number } | null
}

export interface JobListResponse {
  authRequirements: AuthRequirements | null
  jobs: JobListEntry[]
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

/** files[*].original (README: 通常のダウンロード項目 + 専用の thumbnail)。 */
function parseOriginalFileResource(value: unknown): OriginalFileResource | null {
  const base = parseGeneratedFileResource(value)
  if (base === null) return null
  const json = value as Json
  return { ...base, thumbnail: parseGeneratedFileResource(json.thumbnail) }
}

/** files[*].errors (README: location/id/日本語message の配列。成功時は空配列)。 */
function parseProcessedImageFileErrors(value: unknown): ProcessedImageFileError[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return null
      const json = entry as Json
      const location = asString(json.location)
      const id = asString(json.id)
      const message = asString(json.message)
      if (location === null || id === null || message === null) return null
      return { location, id, message }
    })
    .filter((entry): entry is ProcessedImageFileError => entry !== null)
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
    detectedFaceCount: normalizeMetric(asNumber(json.detected_face_count)),
    faceTimeSeconds: normalizeMetric(asNumber(json.face_time_seconds)),
    detectedTextCount: normalizeMetric(asNumber(json.detected_text_count)),
    textTimeSeconds: normalizeMetric(asNumber(json.text_time_seconds)),
    thumbnail: parseGeneratedFileResource(json.thumbnail),
    original: parseOriginalFileResource(json.original),
    errors: parseProcessedImageFileErrors(json.errors),
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

function parseExecutionParameters(value: unknown): ExecutionParameters | null {
  if (typeof value !== 'object' || value === null) return null
  const json = value as Json
  const faceCheck = json.face_check
  const faceMask = json.face_mask
  const textCheck = json.text_check
  const textMask = json.text_mask
  if (
    typeof faceCheck !== 'boolean' ||
    typeof faceMask !== 'boolean' ||
    typeof textCheck !== 'boolean' ||
    typeof textMask !== 'boolean'
  ) {
    return null
  }
  const regexJson = json.regex
  const regex =
    typeof regexJson === 'object' && regexJson !== null
      ? Object.fromEntries(
          Object.entries(regexJson as Json).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : null
  return { faceCheck, faceMask, textCheck, textMask, regex }
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
    executionParameters: parseExecutionParameters(json.execution_parameters),
    uploadedFiles: parseFileCounts(json.uploaded_files, 'uploaded_files'),
    extractedImages: parseFileCounts(json.extracted_images, 'extracted_images'),
    authRequirements: parseAuthRequirements(json.metadata),
    resultFile: parseGeneratedFileResource(json.result_file),
    resultSummary: parseGeneratedFileResource(json.result_summary),
    files,
    error,
    message: asString(json.message),
    expiresAt: asString(json.expires_at),
  }
}

export function parseJobListResponse(value: unknown): JobListResponse {
  const json = asJson(value, 'job list response')
  const jobsJson = json.jobs
  const jobs = Array.isArray(jobsJson)
    ? jobsJson.map((item) => {
        const j = asJson(item, 'jobs[]')
        const jobId = asString(j.job_id)
        const status = asString(j.status)
        if (jobId === null || status === null) {
          throw new Error('jobs[] に job_id または status がありません。')
        }
        const statsJson = j.detection_stats
        const stats =
          typeof statsJson === 'object' && statsJson !== null
            ? {
                detectedFaceCount: asNumber((statsJson as Json).detected_face_count) ?? 0,
                detectedTextCount: asNumber((statsJson as Json).detected_text_count) ?? 0,
              }
            : null
        const execJson = j.execution_parameters
        const executionParameters =
          typeof execJson === 'object' &&
          execJson !== null &&
          typeof (execJson as Json).face_check === 'boolean' &&
          typeof (execJson as Json).face_mask === 'boolean' &&
          typeof (execJson as Json).text_check === 'boolean' &&
          typeof (execJson as Json).text_mask === 'boolean'
            ? {
                faceCheck: (execJson as Json).face_check as boolean,
                faceMask: (execJson as Json).face_mask as boolean,
                textCheck: (execJson as Json).text_check as boolean,
                textMask: (execJson as Json).text_mask as boolean,
              }
            : null
        return {
          jobId,
          startDate: asString(j.start_date) ?? '',
          expiryDate: asString(j.expiry_date) ?? '',
          status: status as ProcessJobStatus,
          executionParameters,
          uploadedFiles: parseFileCounts(j.uploaded_files, 'uploaded_files'),
          extractedImages: parseFileCounts(j.extracted_images, 'extracted_images'),
          detectionStats: stats,
        }
      })
    : []

  return {
    authRequirements: parseAuthRequirements(json.metadata),
    jobs,
  }
}

/** -1 はタスク失敗のセンチネル値。null 化して「未取得/失敗」を表す。 */
export function normalizeMetric(value: number | null): number | null {
  if (value === null || value < 0) return null
  return value
}

/** displayName の先頭セグメント(元のアップロードファイル名)ごとにグルーピングした1件。
 *  UI/UX要件「タスク→アップロードファイル→画像」の段階的ドリルダウンの中間層に対応する。 */
export interface UploadFileGroup {
  /** 元のアップロードファイル名(例: "bundle.zip", "report.pdf", "image.png") */
  uploadFileName: string
  /** そのファイルに含まれる画像群。displayName はファイル内の相対パスも保持したまま。 */
  images: ProcessedImageFileResult[]
  detectedCount: number
  errorCount: number
  /** モックの file-summary-bar「目 / 文字」内訳に相当する、グループ内の検知数合計。 */
  faceCount: number
  textCount: number
}

/** files[] の displayName ("bundle.zip/nested.zip/image_1.png") の先頭セグメントで
 *  アップロードファイル単位にグルーピングする。単一画像アップロードなら1グループのみ。 */
export function groupFilesByUploadFile(files: ProcessedImageFileResult[]): UploadFileGroup[] {
  const groups = new Map<string, ProcessedImageFileResult[]>()
  for (const file of files) {
    const uploadFileName = file.displayName.split('/')[0]
    const bucket = groups.get(uploadFileName)
    if (bucket) {
      bucket.push(file)
    } else {
      groups.set(uploadFileName, [file])
    }
  }

  return Array.from(groups.entries()).map(([uploadFileName, images]) => ({
    uploadFileName,
    images,
    detectedCount: images.filter(
      (img) => (img.detectedFaceCount ?? 0) > 0 || (img.detectedTextCount ?? 0) > 0,
    ).length,
    errorCount: images.filter((img) => img.errors.length > 0).length,
    faceCount: images.reduce((sum, img) => sum + Math.max(0, img.detectedFaceCount ?? 0), 0),
    textCount: images.reduce((sum, img) => sum + Math.max(0, img.detectedTextCount ?? 0), 0),
  }))
}

/** displayName からファイル内の相対パス(先頭セグメントを除いた部分)を取り出す。
 *  例: "bundle.zip/sub.zip/image_1.png" → "sub.zip/image_1.png" */
export function relativePathWithinUploadFile(displayName: string): string {
  const segments = displayName.split('/')
  return segments.length > 1 ? segments.slice(1).join('/') : segments[0]
}
