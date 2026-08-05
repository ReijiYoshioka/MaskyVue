<script setup lang="ts">
// 共通設定画面。上司提示モック(index-03.html)の renderSettings に合わせて、
// 正規表現パターン管理・ライセンス・データ保持基盤情報の3カードで構成する。
//
// 【フロントエンド実装上の制約】
// UI/UX要件書2.9では正規表現パターンを「複数登録してOR条件で管理する、サーバー共通設定」
// と定めているが、現状の user-api には複数パターンを保存するエンドポイントが存在せず、
// タスク登録時に regex= を1つだけ渡す仕様になっている(FaceMask/user-api/workspace/request_processing.py)。
// そのためここでは複数管理テーブルは実装せず、現状の制約を明記した上で
// 「タスク登録時に指定する」という現実の使い方を案内する形にとどめる。
import { computed, ref } from 'vue'
import { useLicenseStatusAdapter } from '@/composables/useLicenseStatusAdapter'
import { useToast } from '@/composables/useToast'

const toast = useToast()

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
        const data = await response.json().catch(() => ({}))
        const messages = Object.values(data)
          .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as { message?: string }).message : null))
          .filter((message): message is string => Boolean(message))
        const message = messages.length > 0 ? messages.join(' / ') : 'ライセンスを認証しました。'
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
          <p>個人情報として扱う文字パターンを指定します</p>
        </div>
      </div>
      <div class="card-body">
        <div class="alert info">
          <v-icon icon="mdi-information-outline" size="18" />
          <div>
            <strong>現状の制約</strong>
            複数パターンをOR条件でサーバー共通管理する機能は、バックエンドAPIが未対応のため実装していません。
            現在は「新しいタスク」の登録画面で、タスクごとに1つの正規表現を指定する形になっています。
          </div>
        </div>
      </div>
    </section>

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

.alert strong {
  display: block;
  margin-bottom: 2px;
  font-size: 14.5px;
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
