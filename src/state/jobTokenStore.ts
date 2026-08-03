// 自分が作成したジョブの Bearer トークンを localStorage に保持する。
// トークンは「そのジョブの詳細取得・操作・ダウンロード」の引換券なので、
// ブラウザを閉じても自分のジョブを操作できるようにする(README: UIがジョブを
// 作成した場合は返された token を job_id と一緒に保持すること)。

const STORAGE_KEY = 'masky.jobTokens.v1'

type TokenMap = Record<string, string>

function load(): TokenMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as TokenMap) : {}
  } catch {
    return {}
  }
}

function save(map: TokenMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ストレージ不可(プライベートモード等)でも動作自体は継続する
  }
}

export function rememberJobToken(jobId: string, token: string) {
  const map = load()
  map[jobId] = token
  save(map)
}

export function getJobToken(jobId: string): string | null {
  return load()[jobId] ?? null
}

export function forgetJobToken(jobId: string) {
  const map = load()
  if (jobId in map) {
    delete map[jobId]
    save(map)
  }
}

/**
 * 一覧 (GET /file-processing-jobs) に存在しない jobId のトークンを掃除する。
 * サーバーの一覧は期限切れジョブを返さない仕様のため、forgetJobToken を個別に
 * 呼ぶ機会がなく、期限切れ後もトークンが localStorage に無期限に残ってしまう。
 * このため、一覧取得後に「現在有効な jobId 一覧」を渡してもらい、それ以外の
 * エントリを一括削除する。
 *
 * 呼び出し箇所: JobListPanel.vue の refresh 関数内、ジョブ一覧取得後。
 */
export function pruneJobTokens(activeJobIds: string[]) {
  const active = new Set(activeJobIds)
  const map = load()
  let changed = false
  for (const jobId of Object.keys(map)) {
    if (!active.has(jobId)) {
      delete map[jobId]
      changed = true
    }
  }
  if (changed) {
    save(map)
  }
}

/** 保持している自分のジョブID一覧 */
export function knownJobIds(): string[] {
  return Object.keys(load())
}

/** 自分のジョブのトークンを含む共有URLを組み立てる。URLを受け取った相手は結果の閲覧・DLができる。 */
export function buildShareUrl(jobId: string, token: string): string {
  const url = new URL(location.href)
  url.hash = ''
  url.search = new URLSearchParams({ job: jobId, token }).toString()
  return url.toString()
}
