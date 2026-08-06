<script setup lang="ts">
// 共通設定画面。上司提示モック(index-03.html)の renderSettings に合わせて、
// 正規表現パターン管理・ライセンス・データ保持基盤情報の3カードで構成する。
//
// 正規表現パターンは user-api の /regex-patterns (GET/PATCH/DELETE/POST reset) で
// 全ユーザー共有・サービス再起動後も保持される(FaceMask/user-api/workspace/regex_storage.py)。
// 一覧のチェックボックスは「タスク登録時に使うかどうか」の選択。選択状態は
// useRegexPatterns で共有するため、「新しいタスク」画面はここで選んだ内容を
// そのまま使う(タスク登録画面側での再選択は行わない)。
import { computed, onMounted, ref } from 'vue'
import { toReadableMessage } from '@/api/http'
import { useLicenseStatusAdapter } from '@/composables/useLicenseStatusAdapter'
import { useRegexPatterns } from '@/composables/useRegexPatterns'
import { useToast } from '@/composables/useToast'

const toast = useToast()

const {
  patterns: regexPatterns,
  isLoading: isRegexLoading,
  loadError: regexLoadError,
  refresh: refreshRegexPatterns,
  addOrUpdate: addOrUpdateRegexPattern,
  remove: removeRegexPattern,
  resetToDefaults: resetRegexPatternsToDefaults,
  selectedNames: selectedRegexPatternNames,
} = useRegexPatterns()

onMounted(() => void refreshRegexPatterns())

// サーバー(regex_storage.py)は元から日本語のメッセージを返すので、そのまま表示すればよい。
// サーバー由来でない例外(ブラウザ/ライブラリの英語メッセージ)は日本語の固定文言に差し替える。
function getReadableRegexErrorMessage(err: unknown): string {
  return toReadableMessage(err, '時間を置いて再度お試しください。')
}

const isAddPatternDialogOpen = ref(false)
const isAddingPattern = ref(false)
const newPatternName = ref('')
const newPatternValue = ref('')

async function submitNewPattern() {
  const name = newPatternName.value.trim()
  const value = newPatternValue.value.trim()
  if (!name || !value) return
  isAddingPattern.value = true
  try {
    await addOrUpdateRegexPattern(name, value)
    toast.success('正規表現パターンを追加しました', name)
    newPatternName.value = ''
    newPatternValue.value = ''
    isAddPatternDialogOpen.value = false
  } catch (err) {
    toast.error('正規表現パターンの追加に失敗しました', getReadableRegexErrorMessage(err))
  } finally {
    isAddingPattern.value = false
  }
}

const editingPatternName = ref<string | null>(null)
const editingPatternValue = ref('')
const isSavingEdit = ref(false)

function startEditingPattern(name: string, value: string) {
  editingPatternName.value = name
  editingPatternValue.value = value
}

function cancelEditingPattern() {
  editingPatternName.value = null
  editingPatternValue.value = ''
}

async function saveEditingPattern() {
  const name = editingPatternName.value
  const value = editingPatternValue.value.trim()
  if (!name || !value) return
  isSavingEdit.value = true
  try {
    await addOrUpdateRegexPattern(name, value)
    toast.success('正規表現パターンを更新しました', name)
    cancelEditingPattern()
  } catch (err) {
    toast.error('正規表現パターンの更新に失敗しました', getReadableRegexErrorMessage(err))
  } finally {
    isSavingEdit.value = false
  }
}

const deletingPatternName = ref<string | null>(null)

async function deletePattern(name: string) {
  if (!window.confirm(`正規表現パターン「${name}」を削除しますか？`)) return
  deletingPatternName.value = name
  try {
    await removeRegexPattern(name)
    toast.success('正規表現パターンを削除しました', name)
  } catch (err) {
    toast.error('正規表現パターンの削除に失敗しました', getReadableRegexErrorMessage(err))
  } finally {
    deletingPatternName.value = null
  }
}

const isResettingPatterns = ref(false)

async function resetPatterns() {
  if (!window.confirm('正規表現パターンを初期値(メールアドレス・日本国内電話番号・マイナンバー)に戻しますか？現在の登録内容は失われます。')) return
  isResettingPatterns.value = true
  try {
    await resetRegexPatternsToDefaults()
    toast.success('正規表現パターンを初期値に戻しました')
  } catch (err) {
    toast.error('初期値への復元に失敗しました', getReadableRegexErrorMessage(err))
  } finally {
    isResettingPatterns.value = false
  }
}

const {
  licenseIndicator,
  isLicenseChecking,
  refreshLicenseStatus,
  expiryInfo,
  lastCheckedAt,
  maskedSerial,
  licenseKey,
  isActivatingLicense,
  licenseFeedback,
  activateLicense,
} = useSettingsLicense()

const MASKED_SERIAL_STORAGE_KEY = 'masky.license.maskedSerial'

function useSettingsLicense() {
  const {
    indicator,
    isChecking,
    refreshLicenseStatus: refresh,
    expiryInfo: expiry,
    lastCheckedAt: checkedAt,
  } = useLicenseStatusAdapter()

  const licenseKey = ref('')
  const isActivatingLicense = ref(false)
  const licenseFeedback = ref<{ tone: 'success' | 'error'; message: string } | null>(null)
  const maskedSerial = ref(localStorage.getItem(MASKED_SERIAL_STORAGE_KEY))

  function getReadableErrorMessage(errorId?: string, originalMessage?: string): string {
    const errorMap: Record<string, string> = {
      invalid_serial_number: 'ライセンスキーの形式が正しくありません。入力内容を確認してください。',
      licence_expired: 'このライセンスキーの有効期限が切れています。新しいキーを登録してください。',
      serial_version_mismatch: 'このライセンスキーはこのシステムのバージョンに対応していません。システムを更新するか、販売元にご確認ください。',
    }
    if (errorId && errorMap[errorId]) return errorMap[errorId]
    if (originalMessage?.includes('有効期限が切れて')) return 'ライセンスの有効期限が切れています。新しいキーを登録してください。'
    if (originalMessage?.includes('無効なシリアル番号')) return 'ライセンスキーが正しくありません。確認してから再度入力してください。'
    return 'ライセンスの認証に失敗しました。入力内容を確認してもう一度試してください。'
  }

  async function activateLicense() {
    if (!licenseKey.value.trim()) return
    isActivatingLicense.value = true
    licenseFeedback.value = null
    try {
      const trimmedKey = licenseKey.value.trim()
      const response = await fetch('/api/update-key?target=all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_key: trimmedKey }),
      })
      if (response.ok) {
        // サーバーは常に英語固定文("The licence key was updated successfully."等)を
        // message に返す(shared/utils/serial_endpoints.py)。バックエンドごとに同じ文が
        // 重複表示されるだけで利用者には意味がないため、message は使わず日本語の固定文言にする。
        const message = 'ライセンスを認証しました。'
        licenseFeedback.value = { tone: 'success', message }
        maskedSerial.value = `••••-••••-••••-${trimmedKey.slice(-4).toUpperCase()}`
        localStorage.setItem(MASKED_SERIAL_STORAGE_KEY, maskedSerial.value)
        licenseKey.value = ''
        toast.success('ライセンスを登録しました', message)
        await refresh()
      } else {
        const data = await response.json().catch(() => ({}))
        const message = getReadableErrorMessage(data.detail?.error_id, data.detail?.message)
        licenseFeedback.value = { tone: 'error', message }
        toast.error('ライセンスの登録に失敗しました', message)
      }
    } catch {
      const message = 'ライセンスキーの入力に問題があります。ネットワーク接続を確認してからもう一度試してください。'
      licenseFeedback.value = { tone: 'error', message }
      toast.error('ライセンスの登録に失敗しました', message)
    } finally {
      isActivatingLicense.value = false
    }
  }

  return {
    licenseIndicator: indicator,
    isLicenseChecking: isChecking,
    refreshLicenseStatus: refresh,
    expiryInfo: expiry,
    lastCheckedAt: checkedAt,
    maskedSerial,
    licenseKey,
    isActivatingLicense,
    licenseFeedback,
    activateLicense,
  }
}

const licenseColor = computed(() => {
  switch (licenseIndicator.value.tone) {
    case 'checking':
      return 'warning'
    case 'active':
      return 'success'
    case 'inactive':
      return 'error'
  }
})

const licenseChipIcon = computed(() => {
  switch (licenseIndicator.value.tone) {
    case 'checking':
      return 'mdi-progress-clock'
    case 'active':
      return 'mdi-check-circle-outline'
    case 'inactive':
      return 'mdi-alert-circle-outline'
  }
})

const licenseStateIcon = computed(() =>
  licenseIndicator.value.tone === 'active' ? 'mdi-shield-check-outline' : 'mdi-shield-alert-outline',
)

function formatDateTime(value: string | null): string {
  if (!value) return '（未確認）'
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const daysRemainingDisplay = computed(() =>
  expiryInfo.value.daysRemaining === null ? '未設定' : `残り ${expiryInfo.value.daysRemaining}日`,
)

const expiryDisplay = computed(() =>
  expiryInfo.value.expiryDate === null ? '-' : formatDateTime(expiryInfo.value.expiryDate),
)
const lastCheckedDisplay = computed(() => formatDateTime(lastCheckedAt.value))
const serialDisplay = computed(() => maskedSerial.value ?? '未登録')
</script>

<template>
  <div class="page-intro">
    <div>
      <h2>共通設定</h2>
      <p>この画面の変更は、すべての利用者に共通で反映されます。</p>
    </div>
  </div>

  <div class="stack">
    <div class="settings-note">
      <v-icon icon="mdi-account-group-outline" size="18" />
      <span>設定はブラウザーではなく、オンプレミスサーバー側に保存される想定です。</span>
    </div>

    <!-- 正規表現パターン -->
    <section class="card">
      <div class="card-header">
        <div class="card-title">
          <h3>文字検知の正規表現パターン</h3>
          <p>登録した{{ regexPatterns.length }}件をOR条件でOCR結果と照合します(タスク登録時に使う分を選択)</p>
        </div>
        <v-btn color="primary" variant="flat" @click="isAddPatternDialogOpen = true">
          <v-icon icon="mdi-plus" start size="18" />
          パターンを追加
        </v-btn>
      </div>
      <div class="card-body">
        <p v-if="regexLoadError" class="alert danger">
          <v-icon icon="mdi-alert-circle-outline" size="18" />
          {{ regexLoadError }}
        </p>
        <div v-else-if="isRegexLoading && regexPatterns.length === 0" class="mk-muted empty-note">読み込み中…</div>
        <p v-else-if="regexPatterns.length === 0" class="mk-muted empty-note">
          正規表現パターンが登録されていません。「パターンを追加」から登録してください。
        </p>
        <div v-else class="table-wrap">
          <table class="pattern-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>正規表現</th>
                <th class="checkbox-col"></th>
                <th class="actions-col"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pattern in regexPatterns" :key="pattern.name">
                <td><strong>{{ pattern.name }}</strong></td>
                <td>
                  <template v-if="editingPatternName === pattern.name">
                    <v-text-field v-model="editingPatternValue" density="compact" hide-details />
                  </template>
                  <code v-else class="pattern-code">{{ pattern.value }}</code>
                </td>
                <td class="checkbox-col">
                  <v-checkbox
                    :model-value="selectedRegexPatternNames.includes(pattern.name)"
                    density="compact"
                    hide-details
                    @update:model-value="(checked) => {
                      const idx = selectedRegexPatternNames.indexOf(pattern.name)
                      if (checked && idx === -1) selectedRegexPatternNames.push(pattern.name)
                      else if (!checked && idx !== -1) selectedRegexPatternNames.splice(idx, 1)
                    }"
                  />
                </td>
                <td class="actions-col">
                  <template v-if="editingPatternName === pattern.name">
                    <v-btn size="small" color="primary" variant="flat" :loading="isSavingEdit" @click="saveEditingPattern">保存</v-btn>
                    <v-btn size="small" variant="outlined" :disabled="isSavingEdit" @click="cancelEditingPattern">取消</v-btn>
                  </template>
                  <template v-else>
                    <v-btn icon="mdi-pencil-outline" size="small" variant="text" density="comfortable" @click="startEditingPattern(pattern.name, pattern.value)" />
                    <v-btn
                      icon="mdi-trash-can-outline"
                      size="small"
                      variant="text"
                      density="comfortable"
                      :loading="deletingPatternName === pattern.name"
                      @click="deletePattern(pattern.name)"
                    />
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="row between mt-16">
          <p class="mk-muted note-text">登録時に構文チェックとテスト文字列へのマッチ確認を行います。</p>
          <v-btn color="secondary" variant="outlined" :loading="isResettingPatterns" @click="resetPatterns">
            <v-icon icon="mdi-restore" start size="16" />
            初期値に戻す
          </v-btn>
        </div>
      </div>
    </section>

    <!-- パターン追加ダイアログ -->
    <v-dialog v-model="isAddPatternDialogOpen" max-width="480">
      <v-card rounded="lg">
        <v-card-title class="dialog-title">新しい正規表現パターン</v-card-title>
        <v-card-text class="stack tight">
          <div class="field">
            <label for="new-pattern-name">名称</label>
            <v-text-field id="new-pattern-name" v-model="newPatternName" placeholder="例: 患者番号" density="comfortable" hide-details :disabled="isAddingPattern" />
          </div>
          <div class="field">
            <label for="new-pattern-value">正規表現</label>
            <v-text-field id="new-pattern-value" v-model="newPatternValue" placeholder="例: \d{2,10}" density="comfortable" hide-details :disabled="isAddingPattern" />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" :disabled="isAddingPattern" @click="isAddPatternDialogOpen = false">キャンセル</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="isAddingPattern"
            :disabled="!newPatternName.trim() || !newPatternValue.trim()"
            @click="submitNewPattern"
          >
            追加
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ライセンス -->
    <section class="card">
      <div class="card-header">
        <div class="card-title">
          <h3>ライセンス</h3>
          <p>オンプレミスサーバーに設定するシリアル番号</p>
        </div>
        <v-chip :color="licenseColor" :loading="isLicenseChecking">
          <v-icon v-if="!isLicenseChecking" :icon="licenseChipIcon" start size="20" />
          {{ licenseIndicator.label }}
        </v-chip>
      </div>
      <div class="card-body license-card">
        <div class="stack tight">
          <div class="field">
            <label for="license-key">新しいライセンスキー</label>
            <v-text-field
              id="license-key"
              v-model="licenseKey"
              placeholder="ライセンスキーを入力"
              density="comfortable"
              :disabled="isActivatingLicense"
              hide-details
            />
          </div>

          <v-alert
            v-if="licenseFeedback"
            :color="licenseFeedback.tone === 'success' ? 'success' : 'error'"
            variant="tonal"
            closable
            @click:close="licenseFeedback = null"
          >
            {{ licenseFeedback.message }}
          </v-alert>

          <div class="row">
            <v-btn
              color="primary"
              variant="flat"
              :loading="isActivatingLicense"
              :disabled="!licenseKey.trim()"
              @click="activateLicense"
            >
              <v-icon icon="mdi-key-outline" start size="18" />
              検証して登録
            </v-btn>
            <v-btn
              color="secondary"
              variant="outlined"
              :disabled="isActivatingLicense || isLicenseChecking"
              @click="refreshLicenseStatus"
            >
              <v-icon icon="mdi-refresh" start size="18" />
              再確認
            </v-btn>
          </div>
        </div>

        <div class="license-state" :class="{ warning: licenseIndicator.tone !== 'active' }">
          <div class="license-state-head">
            <v-icon :icon="licenseStateIcon" size="112" />
          </div>
          <div class="big">{{ daysRemainingDisplay }}</div>
          <div class="license-facts">
            <div class="license-fact"><span>有効期限</span><strong>{{ expiryDisplay }}</strong></div>
            <div class="license-fact"><span>シリアル番号</span><strong>{{ serialDisplay }}</strong></div>
            <div class="license-fact"><span>最終確認</span><strong>{{ lastCheckedDisplay }}</strong></div>
          </div>
        </div>
      </div>
    </section>

    <!-- データ保持・処理基盤(参照のみ) -->
    <section class="card">
      <div class="card-header">
        <div class="card-title">
          <h3>データ保持・処理基盤</h3>
          <p>参照表示のみ（変更不可）</p>
        </div>
      </div>
      <div class="card-body">
        <div class="sysinfo">
          <div class="sysinfo-item">
            <v-icon icon="mdi-calendar-outline" size="22" />
            <div>
              <strong>保持期間：3日間</strong>
              <span>期限後に元ファイル・結果・マスク画像を削除</span>
            </div>
          </div>
          <div class="sysinfo-item">
            <v-icon icon="mdi-server-outline" size="22" />
            <div>
              <strong>同時AI処理：1タスク</strong>
              <span>キューで順次処理</span>
            </div>
          </div>
          <div class="sysinfo-item">
            <v-icon icon="mdi-refresh" size="22" />
            <div>
              <strong>キュー更新間隔：約3秒</strong>
              <span>ポーリングによる自動更新</span>
            </div>
          </div>
          <div class="sysinfo-item">
            <v-icon icon="mdi-lock-outline" size="22" />
            <div>
              <strong>アクセス方式：トークン</strong>
              <span>ログイン・管理者ロールなし</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-intro {
  margin-bottom: 22px;
}

.page-intro h2 {
  margin: 0;
  font-size: 27px;
  line-height: 1.3;
  letter-spacing: -.03em;
}

.page-intro p {
  max-width: 720px;
  margin: 8px 0 0;
  color: var(--mk-muted);
  font-size: 14.5px;
}

.stack {
  display: grid;
  gap: 18px;
}

.stack.tight {
  gap: 10px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-note {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid #d5e2f4;
  border-radius: 12px;
  background: #f2f7fd;
  color: #345f84;
  font-size: 13.5px;
}

.card {
  background: #fff;
  border: 1px solid var(--mk-border);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
}

.card-header {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--mk-border);
}

.card-title h3 {
  margin: 0;
  font-size: 16.5px;
  letter-spacing: -.01em;
}

.card-title p {
  margin: 3px 0 0;
  color: var(--mk-muted);
  font-size: 12.5px;
}

.card-body {
  padding: 22px;
}

.alert {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid;
  border-radius: 12px;
  font-size: 14px;
}

.alert.info {
  color: #275b83;
  background: #eaf4fc;
  border-color: #cde4f4;
}

.alert.danger {
  color: #92323b;
  background: #ffeff0;
  border-color: #efc9cd;
}

.alert strong {
  display: block;
  margin-bottom: 2px;
  font-size: 14.5px;
}

.empty-note {
  padding: 2rem 0;
  text-align: center;
}

.table-wrap {
  overflow-x: auto;
}

.pattern-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.pattern-table th {
  padding: 8px 10px;
  border-bottom: 1px solid var(--mk-border);
  color: var(--mk-muted);
  font-weight: 700;
  text-align: left;
}

.pattern-table td {
  padding: 10px;
  border-bottom: 1px solid var(--mk-border);
  vertical-align: middle;
}

.pattern-table .actions-col {
  width: 1px;
  white-space: nowrap;
  text-align: right;
}

.pattern-table .checkbox-col {
  width: 1px;
  padding-right: 40px;
  white-space: nowrap;
}

.pattern-table .checkbox-col :deep(.v-selection-control) {
  min-height: 0;
}

.pattern-code {
  padding: 2px 6px;
  border-radius: 6px;
  background: #f3f5f8;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
}

.row.between {
  justify-content: space-between;
}

.note-text {
  margin: 0;
  font-size: 12.5px;
}

.mt-16 {
  margin-top: 16px;
}

.dialog-title {
  padding: 20px 24px 4px;
  font-size: 18px;
  font-weight: 700;
}

.license-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 22px;
  align-items: start;
}

.field {
  display: grid;
  gap: 7px;
}

.field > label {
  color: var(--mk-muted);
  font-size: 13px;
  font-weight: 800;
}

.license-state {
  padding: 22px;
  border-radius: 14px;
  color: #eaf8f4;
  background: linear-gradient(135deg, #16483e, #1e725f);
}

.license-state-head {
  display: flex;
  justify-content: center;
}

.license-state .big {
  margin-top: 16px;
  text-align: center;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.02em;
}

.license-facts {
  margin-top: 16px;
  display: grid;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, .18);
}

.license-fact {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #cfeae2;
  font-size: 12.5px;
}

.license-fact strong {
  color: #fff;
}

.license-state.warning {
  color: #fff6e8;
  background: linear-gradient(135deg, #6e4405, #a9690b);
}

.license-state.warning .license-facts {
  border-top-color: rgba(255, 255, 255, .22);
}

.license-state.warning .license-fact {
  color: #f3dcb2;
}

.sysinfo {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.sysinfo-item {
  display: flex;
  gap: 13px;
  padding: 15px;
  border: 1px solid var(--mk-border);
  border-radius: 12px;
  background: #fbfcfe;
}

.sysinfo-item strong {
  display: block;
  font-size: 15px;
}

.sysinfo-item span {
  display: block;
  margin-top: 2px;
  color: var(--mk-muted);
  font-size: 12.5px;
}

.ml-2 {
  margin-left: 0.5rem;
}

@media (max-width: 900px) {
  .license-card {
    grid-template-columns: 1fr;
  }
  .sysinfo {
    grid-template-columns: 1fr;
  }
}
</style>
