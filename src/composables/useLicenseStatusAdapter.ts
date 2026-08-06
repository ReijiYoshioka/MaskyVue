import { computed, onMounted, ref } from 'vue'
import { withStartupRetry } from '@/api/http'
import type { LicenseStatusResponse, LicenseStatusIndicator } from '@/types/licenseStatus'

export interface LicenseExpiryInfo {
  expiryDate: string | null
  daysRemaining: number | null
  tone: 'active' | 'soon' | 'expired' | 'unlimited'
}

// モジュールスコープで保持し、App.vue と SettingsPage.vue など複数箇所から呼んでも
// 同じ状態を共有する(シングルトン)。設定画面でライセンスを登録した直後に、
// 画面上部の警告バナー側が古い状態のまま取り残される、という不整合を防ぐため。
const status = ref<LicenseStatusResponse>({
  sessionId: null,
  licenseStatus: 'NOT_ACTIVATED',
  expiresAt: null,
  isUsable: false,
  isAdmin: false,
})
const isChecking = ref(true)
const expiryInfo = ref<LicenseExpiryInfo>({
  expiryDate: null,
  daysRemaining: null,
  tone: 'expired',
})
const lastCheckedAt = ref<string | null>(null)
let hasStartedInitialFetch = false

export function useLicenseStatusAdapter() {

  function calculateExpiry(
    eyeEndDate?: string | null,
    ocrEndDate?: string | null,
  ): LicenseExpiryInfo {
    // バックエンド仕様: end_date が null は「無期限で有効」を意味する。
    // 両方が無期限の場合は、期限切れではなく無期限ライセンスとして扱う。
    if (eyeEndDate === null && ocrEndDate === null) {
      return { expiryDate: null, daysRemaining: null, tone: 'unlimited' }
    }

    // 片方だけ無期限（null）で、もう片方に実際の期限日がある場合は、
    // 制限のある方の期限日を採用する。
    const candidateDates = [eyeEndDate, ocrEndDate].filter(
      (date): date is string => typeof date === 'string' && date.length > 0,
    )

    if (candidateDates.length === 0) {
      return { expiryDate: null, daysRemaining: null, tone: 'expired' }
    }

    // より早い期限日を採用（両方が有効な期間は、より制限的な方）
    const minEndDate = candidateDates.sort()[0]
    const expiryDate = new Date(minEndDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expiryDate.setHours(0, 0, 0, 0)

    const msPerDay = 24 * 60 * 60 * 1000
    const daysRemaining = Math.ceil((expiryDate.getTime() - today.getTime()) / msPerDay)

    let tone: 'active' | 'soon' | 'expired'
    if (daysRemaining <= 0) {
      tone = 'expired'
    } else if (daysRemaining <= 7) {
      tone = 'soon'
    } else {
      tone = 'active'
    }

    return {
      expiryDate: minEndDate,
      daysRemaining: Math.max(0, daysRemaining),
      tone,
    }
  }

  async function fetchLicenseStatusOnce() {
    const response = await fetch('/api/get-key-details?target=all')
    if (!response.ok) throw new Error('Failed to fetch')

    const data = await response.json()
    const eyesValid = data['eye-masking']?.version && data['eye-masking']?.start_date
    const ocrValid = data['ocr-masking']?.version && data['ocr-masking']?.start_date

    const isUsable = eyesValid && ocrValid
    const eyeEndDate = data['eye-masking']?.end_date
    const ocrEndDate = data['ocr-masking']?.end_date

    expiryInfo.value = calculateExpiry(eyeEndDate, ocrEndDate)

    status.value = {
      sessionId: null,
      licenseStatus: isUsable ? 'ACTIVE' : 'NOT_ACTIVATED',
      expiresAt: expiryInfo.value.expiryDate || null,
      isUsable,
      isAdmin: false,
    }
  }

  async function refreshLicenseStatus(options?: { retryOnStartup?: boolean }) {
    isChecking.value = true
    try {
      if (options?.retryOnStartup) {
        await withStartupRetry(fetchLicenseStatusOnce)
      } else {
        await fetchLicenseStatusOnce()
      }
    } catch {
      status.value.licenseStatus = 'REVOKED'
      status.value.isUsable = false
      expiryInfo.value = { expiryDate: null, daysRemaining: null, tone: 'expired' }
    } finally {
      lastCheckedAt.value = new Date().toISOString()
      isChecking.value = false
    }
  }

  const indicator = computed<LicenseStatusIndicator>(() => {
    if (isChecking.value) {
      return { tone: 'checking', label: '確認中', title: 'ライセンス状態を確認中' }
    }
    return status.value.isUsable
      ? { tone: 'active', label: '有効', title: 'ライセンスは有効です' }
      : { tone: 'inactive', label: '無効', title: 'ライセンス未認証です' }
  })

  const expiryTone = computed(() => {
    if (isChecking.value) return 'warning'
    switch (expiryInfo.value.tone) {
      case 'active':
        return 'success'
      case 'soon':
        return 'warning'
      case 'expired':
        return 'error'
      case 'unlimited':
        return 'success'
    }
  })

  // 状態はシングルトンで共有されるため、初回の取得は最初にマウントされた
  // コンポーネントの分だけ行えばよい(2箇所目以降での再フェッチは不要)。
  onMounted(() => {
    if (hasStartedInitialFetch) return
    hasStartedInitialFetch = true
    void refreshLicenseStatus({ retryOnStartup: true })
  })

  return { status, isChecking, indicator, refreshLicenseStatus, expiryInfo, expiryTone, lastCheckedAt }
}
