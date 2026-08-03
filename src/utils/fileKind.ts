// 拡張子別のアイコン・配色(index-03.html の fileType()/.file-icon.{zip,pdf,office,image} に相当)。
// アップロード時のファイル一覧(App.vue)と処理結果のファイル一覧(ResultExplorer.vue)で同じ見た目にする。
export type FileKind = 'zip' | 'pdf' | 'office' | 'image'

export function fileKind(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'zip') return 'zip'
  if (ext === 'pdf') return 'pdf'
  if (['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls'].includes(ext)) return 'office'
  return 'image'
}

export const FILE_KIND_ICONS: Record<FileKind, string> = {
  zip: 'mdi-folder-zip-outline',
  pdf: 'mdi-file-pdf-box',
  office: 'mdi-file-document-outline',
  image: 'mdi-file-image-outline',
}

export function fileTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() ?? ''
  return ext || 'IMAGE'
}
