// user-api への通信の土台。参照: MaskyFlutter/lib/services/network_request.dart

const API_PREFIX = '/api'
const DEFAULT_TIMEOUT_MS = 20_000

export class ApiRequestError extends Error {}

/**
 * catch (err) で受け取った例外を画面表示用の日本語メッセージに変換する。
 * ApiRequestError(サーバーの日本語メッセージ由来)ならそのまま使い、それ以外
 * (ブラウザ/ライブラリ組み込みの例外は英語のことが多い)は必ず fallback の日本語文言にする。
 */
export function toReadableMessage(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback
}

/**
 * サーバーは常に {"detail": {"error_id": ..., "message": "日本語の説明"}} 形式でエラーを返す
 * (shared/utils/api_endpoints.py api_error_detail)。生の JSON をそのまま利用者に見せず、
 * 人が読める message だけを抜き出す。パースできない場合のみ汎用メッセージにフォールバックする
 * (HTTPステータスコードは利用者に意味を持たないため表示しない)。
 */
function extractErrorMessage(action: string, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { detail?: { message?: unknown } }
    const message = parsed.detail?.message
    if (typeof message === 'string' && message.trim()) return message
  } catch {
    // 本文が JSON でない場合は下のフォールバックを使う
  }
  return `${action}に失敗しました。時間を置いて再度お試しください。`
}

/**
 * サーバーが返す URL（例: "/generated-files/xyz"）は user-api のルート基準の相対パス。
 * Vite/nginx の /api プロキシ経由で叩くため、/api を前置する。
 */
export function resolveApiUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  return rawUrl.startsWith('/') ? `${API_PREFIX}${rawUrl}` : `${API_PREFIX}/${rawUrl}`
}

/**
 * fetch 自体をここで呼び出し、AbortController の signal を確実に fetch に渡す。
 * (以前は既に呼び出し済みの Promise を受け取って abort() していたため、
 *  abort が実際の HTTP リクエストと無関係な signal を発火するだけで、
 *  リクエストが中断されずタイムアウトが機能していなかった。)
 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number, action: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(`${action} 中にタイムアウトしました。`)
    }
    throw new ApiRequestError(`${action} 中にネットワークエラーが発生しました。通信環境をご確認のうえ、時間を置いて再度お試しください。`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * コンテナ起動直後はバックエンドの準備(自己診断・依存ライブラリの読み込み)が
 * フロントエンドより遅れて完了するため、初回ロード時の取得はここで数秒間リトライしてから
 * 失敗を確定させる。ユーザー操作による再取得(手動更新・ポーリング等)には使わない。
 */
export async function withStartupRetry<T>(fn: () => Promise<T>): Promise<T> {
  const attempts = 8
  const delayMs = 1500
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === attempts - 1) throw err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error('unreachable')
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit
  action: string
  timeoutMs?: number
}

/** JSON ボディを期待するリクエスト。HTTPエラー時は本文を含めて例外化する。 */
export async function requestJson(rawUrl: string, options: RequestOptions): Promise<unknown> {
  const url = resolveApiUrl(rawUrl)
  const res = await fetchWithTimeout(
    url,
    { method: options.method ?? 'GET', headers: options.headers, body: options.body },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.action,
  )
  const bodyText = await res.text()
  if (!res.ok) {
    throw new ApiRequestError(extractErrorMessage(options.action, bodyText))
  }
  if (bodyText.length === 0) return null
  try {
    return JSON.parse(bodyText)
  } catch {
    throw new ApiRequestError(`${options.action}の応答を解析できませんでした。時間を置いて再度お試しください。`)
  }
}

/** 認証ヘッダーが必要な画像/ファイルを Blob として取得する。 */
export async function requestBlob(rawUrl: string, token: string | null, action: string): Promise<Blob> {
  const url = resolveApiUrl(rawUrl)
  const headers: Record<string, string> = token ? { Authorization: token } : {}
  const res = await fetchWithTimeout(url, { headers }, DEFAULT_TIMEOUT_MS, action)
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new ApiRequestError(extractErrorMessage(action, bodyText))
  }
  return res.blob()
}
