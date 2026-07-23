import { computed, onMounted, ref } from 'vue'
import type { LicenseStatusResponse, LicenseStatusIndicator } from '@/types/licenseStatus'

export interface LicenseExpiryInfo {
  expiryDate: string | null
  daysRemaining: number | null
  tone: 'active' | 'soon' | 'expired'
}

export function useLicenseStatusAdapter() {
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

  function calculateExpiry(eyeEndDate?: string, ocrEndDate?: string): LicenseExpiryInfo {
    if (!eyeEndDate || !ocrEndDate) {
      return { expiryDate: null, daysRemaining: null, tone: 'expired' }
    }

    // より早い期限日を採用（両方が有効な期間は、より制限的な方）
    const minEndDate = [eyeEndDate, ocrEndDate].sort()[0]
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

  async function refreshLicenseStatus() {
    isChecking.value = true
    try {
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
    } catch {
      status.value.licenseStatus = 'REVOKED'
      expiryInfo.value = { expiryDate: null, daysRemaining: null, tone: 'expired' }
    } finally {
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
    }
  })

  onMounted(() => void refreshLicenseStatus())

  return { status, isChecking, indicator, refreshLicenseStatus, expiryInfo, expiryTone }
}
