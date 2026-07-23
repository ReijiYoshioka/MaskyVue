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

/** 保持している自分のジョブID一覧 */
export function knownJobIds(): string[] {
  return Object.keys(load())
}
