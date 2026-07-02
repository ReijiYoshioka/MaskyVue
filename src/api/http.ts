// user-api への通信の土台。参照: MaskyFlutter/lib/services/network_request.dart

const API_PREFIX = '/api'
const DEFAULT_TIMEOUT_MS = 20_000

export class ApiRequestError extends Error {}

/**
 * サーバーが返す URL（例: "/generated-files/xyz"）は user-api のルート基準の相対パス。
 * Vite/nginx の /api プロキシ経由で叩くため、/api を前置する。
 */
export function resolveApiUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl
  return rawUrl.startsWith('/') ? `${API_PREFIX}${rawUrl}` : `${API_PREFIX}/${rawUrl}`
}

async function withTimeout<T>(promise: Promise<T>, ms: number, action: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await promise
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(`${action} 中にタイムアウトしました。`)
    }
    throw new ApiRequestError(`${action} 中にネットワークエラーが発生しました: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
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
  const res = await withTimeout(
    fetch(url, { method: options.method ?? 'GET', headers: options.headers, body: options.body }),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options.action,
  )
  const bodyText = await res.text()
  if (!res.ok) {
    throw new ApiRequestError(`${options.action} に失敗しました (HTTP ${res.status}): ${bodyText.slice(0, 300)}`)
  }
  return bodyText.length > 0 ? JSON.parse(bodyText) : null
}

/** 認証ヘッダーが必要な画像/ファイルを Blob として取得する。 */
export async function requestBlob(rawUrl: string, token: string | null, action: string): Promise<Blob> {
  const url = resolveApiUrl(rawUrl)
  const headers: Record<string, string> = token ? { Authorization: token } : {}
  const res = await withTimeout(fetch(url, { headers }), DEFAULT_TIMEOUT_MS, action)
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    throw new ApiRequestError(`${action} に失敗しました (HTTP ${res.status}): ${bodyText.slice(0, 300)}`)
  }
  return res.blob()
}
