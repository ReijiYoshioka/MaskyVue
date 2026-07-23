export interface LicenseStatusResponse {
  sessionId: string | null
  licenseStatus: 'NOT_ACTIVATED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  expiresAt: string | null
  isUsable: boolean
  isAdmin: boolean
}

export interface LicenseStatusIndicator {
  tone: 'active' | 'inactive' | 'checking'
  label: string
  title: string
}
