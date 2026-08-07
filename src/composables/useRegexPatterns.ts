import { computed, ref, watch } from 'vue'
import { toReadableMessage, withStartupRetry } from '@/api/http'
import { deleteRegexPattern, fetchRegexPatterns, patchRegexPattern } from '@/api/userApi'
import type { RegexPattern } from '@/types/regexPattern'

/**
 * サーバー共通の正規表現パターン一覧(全ユーザー共有、サービス再起動後も保持)。
 * 設定画面(一覧管理)とタスク登録画面(複数選択)の両方から使う想定なので、
 * コンポーネント間で状態を共有するシングルトンにする(App.vue の
 * useLicenseStatusAdapter と同じ理由: 片方で追加・削除した内容が
 * もう片方にすぐ反映されるようにするため)。
 *
 * 「有効/無効」(=タスク登録時に使う分)は現時点ではブラウザ側(localStorage)のみで持つ
 * (バックエンドはまだ enabled フラグを保存できないため)。リロードごとに選び直す手間を避ける
 * ため、選択状態はブラウザに保存して次回も引き継ぐ。
 */
const patterns = ref<RegexPattern[]>([])
const isLoading = ref(false)
const loadError = ref('')
let hasLoadedOnce = false

// 保存値が無い(初回訪問)場合だけ「全件有効」を初期値にする。空配列で保存されている場合は
// 利用者が意図的に全て無効化した状態なので、そのまま空で復元する。
const ENABLED_NAMES_STORAGE_KEY = 'masky-vue-enabled-regex-names'

function loadStoredEnabledNames(): string[] | null {
  const raw = localStorage.getItem(ENABLED_NAMES_STORAGE_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') ? parsed : null
  } catch {
    return null
  }
}

const enabledNames = ref<string[]>(loadStoredEnabledNames() ?? [])

watch(
  enabledNames,
  (value) => {
    localStorage.setItem(ENABLED_NAMES_STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

export function useRegexPatterns() {
  async function refresh() {
    isLoading.value = true
    loadError.value = ''
    try {
      // 初回ロードはコンテナ起動直後にバックエンドの準備が遅れているケースがあるため、
      // ここでリトライして吸収する(手動更新や有効/無効の切り替え等はこの関数を経由しない)。
      patterns.value = await withStartupRetry(fetchRegexPatterns)
      hasLoadedOnce = true
      // 保存された有効状態が無い(=このブラウザで一度も操作したことがない)ときだけ
      // 全件を初期値として有効にする(モックの「全パターンOR条件で照合」に合わせる)。
      if (loadStoredEnabledNames() === null && enabledNames.value.length === 0 && patterns.value.length > 0) {
        enabledNames.value = patterns.value.map((p) => p.name)
      } else {
        pruneEnabledNames()
      }
    } catch (err) {
      loadError.value = toReadableMessage(err, '正規表現パターンの取得に失敗しました。時間を置いて再度お試しください。')
    } finally {
      isLoading.value = false
    }
  }

  async function addOrUpdate(name: string, value: string, previousName?: string) {
    patterns.value = await patchRegexPattern(name, value)
    // 名前を変更しての編集は削除+追加ではなく上書きなので、旧名が別名になった場合は
    // 有効状態を追従させる(そうしないと有効だったはずのパターンが無効に見える)。
    if (previousName && previousName !== name) {
      const index = enabledNames.value.indexOf(previousName)
      if (index !== -1) enabledNames.value.splice(index, 1, name)
    } else if (!previousName && !enabledNames.value.includes(name)) {
      enabledNames.value.push(name)
    }
  }

  async function remove(name: string) {
    patterns.value = await deleteRegexPattern(name)
    const index = enabledNames.value.indexOf(name)
    if (index !== -1) enabledNames.value.splice(index, 1)
  }

  function setEnabled(name: string, enabled: boolean) {
    const index = enabledNames.value.indexOf(name)
    if (enabled && index === -1) {
      enabledNames.value.push(name)
    } else if (!enabled && index !== -1) {
      enabledNames.value.splice(index, 1)
    }
  }

  function isEnabled(name: string): boolean {
    return enabledNames.value.includes(name)
  }

  /** サーバーからもう存在しなくなった名前を有効状態から掃除する。 */
  function pruneEnabledNames() {
    const existingNames = new Set(patterns.value.map((p) => p.name))
    enabledNames.value = enabledNames.value.filter((name) => existingNames.has(name))
  }

  const enabledPatterns = computed(() => patterns.value.filter((p) => enabledNames.value.includes(p.name)))

  /** まだ一度も取得していなければ取得する。複数コンポーネントから呼ばれても初回分だけ通信する。 */
  function ensureLoaded() {
    if (hasLoadedOnce || isLoading.value) return
    void refresh()
  }

  return {
    patterns,
    isLoading,
    loadError,
    refresh,
    addOrUpdate,
    remove,
    setEnabled,
    isEnabled,
    ensureLoaded,
    enabledPatterns,
  }
}
