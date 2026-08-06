import { computed, ref } from 'vue'
import { toReadableMessage, withStartupRetry } from '@/api/http'
import {
  deleteRegexPattern,
  fetchRegexPatterns,
  patchRegexPattern,
  resetRegexPatterns,
} from '@/api/userApi'
import type { RegexPattern } from '@/types/regexPattern'

/**
 * サーバー共通の正規表現パターン一覧(全ユーザー共有、サービス再起動後も保持)。
 * 設定画面(一覧管理)とタスク登録画面(複数選択)の両方から使う想定なので、
 * コンポーネント間で状態を共有するシングルトンにする(App.vue の
 * useLicenseStatusAdapter と同じ理由: 片方で追加・削除した内容が
 * もう片方にすぐ反映されるようにするため)。
 *
 * 「タスク登録時に使う分」の選択状態(selectedNames)も同じ理由でここに置く。
 * 共通設定画面のチェックボックスと、新しいタスク画面のダイアログのチェックボックスは
 * 同じ選択状態を指しているため、どちらで変更してももう片方に反映される。
 */
const patterns = ref<RegexPattern[]>([])
const isLoading = ref(false)
const loadError = ref('')
let hasLoadedOnce = false

const selectedNames = ref<string[]>([])

export function useRegexPatterns() {
  async function refresh() {
    isLoading.value = true
    loadError.value = ''
    try {
      // 初回ロードはコンテナ起動直後にバックエンドの準備が遅れているケースがあるため、
      // ここでリトライして吸収する(手動更新や選択操作等はこの関数を経由しない)。
      patterns.value = await withStartupRetry(fetchRegexPatterns)
      hasLoadedOnce = true
      // まだ何も選んでいなければ全件を初期選択する(モックの「全パターンOR条件で照合」に合わせる)。
      if (selectedNames.value.length === 0 && patterns.value.length > 0) {
        selectedNames.value = patterns.value.map((p) => p.name)
      } else {
        pruneSelection()
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
    // 選択状態を追従させる(そうしないと選択していたはずのパターンが外れて見える)。
    if (previousName && previousName !== name) {
      const index = selectedNames.value.indexOf(previousName)
      if (index !== -1) selectedNames.value.splice(index, 1, name)
    } else if (!previousName && !selectedNames.value.includes(name)) {
      selectedNames.value.push(name)
    }
  }

  async function remove(name: string) {
    patterns.value = await deleteRegexPattern(name)
    const index = selectedNames.value.indexOf(name)
    if (index !== -1) selectedNames.value.splice(index, 1)
  }

  async function resetToDefaults() {
    patterns.value = await resetRegexPatterns()
    selectedNames.value = patterns.value.map((p) => p.name)
  }

  /** サーバーからもう存在しなくなった名前を選択状態から掃除する。 */
  function pruneSelection() {
    const existingNames = new Set(patterns.value.map((p) => p.name))
    selectedNames.value = selectedNames.value.filter((name) => existingNames.has(name))
  }

  function isSelected(name: string): boolean {
    return selectedNames.value.includes(name)
  }

  function setSelected(name: string, selected: boolean) {
    const index = selectedNames.value.indexOf(name)
    if (selected && index === -1) {
      selectedNames.value.push(name)
    } else if (!selected && index !== -1) {
      selectedNames.value.splice(index, 1)
    }
  }

  const selectedPatterns = computed(() => patterns.value.filter((p) => selectedNames.value.includes(p.name)))

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
    resetToDefaults,
    ensureLoaded,
    selectedNames,
    selectedPatterns,
    isSelected,
    setSelected,
  }
}
