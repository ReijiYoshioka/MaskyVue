<script setup lang="ts">
// UI/UX要件書 4章「推奨する見せ方」: タスク→アップロードファイル→画像の段階的ドリルダウン。
// Googleドライブのフォルダ階層と同じく、同一エリアの表示内容が深く詳細になっていく単一ビュー遷移で実装する
// (3カラム同時表示ではなく、レベルを1つずつ切り替えてブレッドクラムで現在地を示す)。
import { computed, ref, watch } from 'vue'
import { fetchGeneratedFileBlob } from '@/api/userApi'
import { useGeneratedFileBlobs } from '@/composables/useGeneratedFileBlobs'
import {
  groupFilesByUploadFile,
  relativePathWithinUploadFile,
  type JobStatusResponse,
  type ProcessedImageFileResult,
  type UploadFileGroup,
} from '@/types/processJob'

const props = defineProps<{
  jobStatus: JobStatusResponse
  token: string
  /** アップロード時にクライアントが保持していた元ファイル群。単一画像アップロード時のみ before 表示に使う。 */
  uploadedFiles: File[]
}>()

type Level = 'files' | 'images' | 'detail'

const level = ref<Level>('files')
const selectedGroup = ref<UploadFileGroup | null>(null)
const selectedImage = ref<ProcessedImageFileResult | null>(null)
const onlyDetected = ref(false)

const { resolve: resolveBlobUrl, isLoading: isBlobLoading } = useGeneratedFileBlobs(props.token)

const groups = computed(() => groupFilesByUploadFile(props.jobStatus.files))

const totalDetected = computed(() =>
  props.jobStatus.files.filter(
    (f) => (f.detectedFaceCount ?? 0) > 0 || (f.detectedTextCount ?? 0) > 0,
  ).length,
)
const totalErrors = computed(() => props.jobStatus.files.filter((f) => f.error !== null).length)
const totalFaceCount = computed(() =>
  props.jobStatus.files.reduce((sum, f) => sum + Math.max(0, f.detectedFaceCount ?? 0), 0),
)
const totalTextCount = computed(() =>
  props.jobStatus.files.reduce((sum, f) => sum + Math.max(0, f.detectedTextCount ?? 0), 0),
)

// 単一画像アップロード(zip/PDF/Office を介さない直接の画像1枚)の場合のみ、
// クライアント側に保持している元ファイルをそのまま before 画像として使える。
const isSingleImageUpload = computed(
  () => props.uploadedFiles.length === 1 && groups.value.length === 1 && groups.value[0].images.length === 1,
)

const visibleImages = computed(() => {
  if (!selectedGroup.value) return []
  if (!onlyDetected.value) return selectedGroup.value.images
  return selectedGroup.value.images.filter(
    (img) => (img.detectedFaceCount ?? 0) > 0 || (img.detectedTextCount ?? 0) > 0,
  )
})

const beforeImageUrl = ref<string | null>(null)
const afterImageUrl = ref<string | null>(null)
const thumbnailUrls = ref<Record<string, string>>({})

function openGroup(group: UploadFileGroup) {
  selectedGroup.value = group
  selectedImage.value = null
  level.value = 'images'
  void loadThumbnailsFor(group)
}

async function loadThumbnailsFor(group: UploadFileGroup) {
  for (const image of group.images) {
    const key = image.displayName
    if (thumbnailUrls.value[key] || !image.thumbnail?.url) continue
    const url = await resolveBlobUrl(image.thumbnail.url)
    if (url) thumbnailUrls.value = { ...thumbnailUrls.value, [key]: url }
  }
}

async function openImage(image: ProcessedImageFileResult) {
  selectedImage.value = image
  level.value = 'detail'
  afterImageUrl.value = null
  beforeImageUrl.value = null

  if (image.url) {
    afterImageUrl.value = await resolveBlobUrl(image.url)
  }

  if (isSingleImageUpload.value && props.uploadedFiles[0]) {
    beforeImageUrl.value = URL.createObjectURL(props.uploadedFiles[0])
  }
}

function backToFiles() {
  level.value = 'files'
  selectedGroup.value = null
  selectedImage.value = null
}

function backToImages() {
  level.value = 'images'
  selectedImage.value = null
}

const isBundleDownloading = ref(false)

/** タスク単位の一括ダウンロード(UI/UX要件2.8: 一括ダウンロードは必須)。results.zip を取得する。 */
async function downloadBundle() {
  const resultFile = props.jobStatus.resultFile
  if (!resultFile?.url) return
  isBundleDownloading.value = true
  try {
    const blob = await fetchGeneratedFileBlob(resultFile.url, props.token)
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = resultFile.downloadName
    link.click()
    URL.revokeObjectURL(objectUrl)
  } finally {
    isBundleDownloading.value = false
  }
}

// ジョブが切り替わったら(結果が新しくなったら)ドリルダウン状態を先頭に戻す
watch(
  () => props.jobStatus,
  () => backToFiles(),
)

const ERROR_LABELS: Record<string, string> = {
  image_unreadable: '画像を読み込めませんでした',
  face_failed: '目の検知/マスキングに失敗',
  text_failed: '文字列の検知/マスキングに失敗',
  both_failed: '目・文字列とも検知/マスキングに失敗',
}

function formatExpiresAt(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="result-explorer">
    <!-- タスク全体のサマリー(常に表示) -->
    <div class="result-explorer__summary">
      <div class="result-explorer__stat">
        <span class="result-explorer__stat-num">{{ groups.length }}</span>
        <span class="result-explorer__stat-label">アップロードファイル</span>
      </div>
      <div class="result-explorer__stat">
        <span class="result-explorer__stat-num">{{ jobStatus.files.length }}</span>
        <span class="result-explorer__stat-label">画像枚数</span>
      </div>
      <div class="result-explorer__stat">
        <span class="result-explorer__stat-num">{{ totalDetected }}</span>
        <span class="result-explorer__stat-label">個人情報検知あり</span>
      </div>
      <div class="result-explorer__stat">
        <span class="result-explorer__stat-num">{{ totalFaceCount }} / {{ totalTextCount }}</span>
        <span class="result-explorer__stat-label">検知数内訳（目 / 文字）</span>
      </div>
      <div v-if="totalErrors > 0" class="result-explorer__stat result-explorer__stat--error">
        <span class="result-explorer__stat-num">{{ totalErrors }}</span>
        <span class="result-explorer__stat-label">エラー</span>
      </div>
    </div>

    <!-- 一括ダウンロードと保持期限(UI/UX要件2.7, 2.8) -->
    <div class="result-explorer__download-row">
      <button
        v-if="jobStatus.resultFile"
        class="mk-button result-explorer__bundle-btn"
        :disabled="isBundleDownloading"
        @click="downloadBundle"
      >
        <v-progress-circular v-if="isBundleDownloading" indeterminate size="16" width="2" />
        <v-icon v-else icon="mdi-package-down" start size="18" />
        一括ダウンロード（{{ jobStatus.resultFile.downloadName }}）
      </button>
      <span class="mk-muted result-explorer__expiry">
        保持期限: {{ formatExpiresAt(jobStatus.resultFile?.expiresAt ?? jobStatus.expiresAt) }} まで
      </span>
    </div>

    <!-- ブレッドクラム: 現在地を常に示す -->
    <div class="result-explorer__breadcrumb">
      <button class="result-explorer__crumb" :class="{ 'result-explorer__crumb--active': level === 'files' }" @click="backToFiles">
        <v-icon icon="mdi-folder-outline" size="16" />
        ファイル一覧
      </button>
      <template v-if="selectedGroup">
        <v-icon icon="mdi-chevron-right" size="16" class="result-explorer__crumb-sep" />
        <button class="result-explorer__crumb" :class="{ 'result-explorer__crumb--active': level === 'images' }" @click="backToImages">
          {{ selectedGroup.uploadFileName }}
        </button>
      </template>
      <template v-if="selectedImage">
        <v-icon icon="mdi-chevron-right" size="16" class="result-explorer__crumb-sep" />
        <span class="result-explorer__crumb result-explorer__crumb--active">
          {{ relativePathWithinUploadFile(selectedImage.displayName) }}
        </span>
      </template>
    </div>

    <!-- レベル1: アップロードファイル一覧 -->
    <div v-if="level === 'files'" class="result-explorer__panel">
      <div v-if="groups.length === 0" class="mk-muted result-explorer__empty">
        表示できる画像がありません。
      </div>
      <div v-else class="result-explorer__file-list">
        <button
          v-for="group in groups"
          :key="group.uploadFileName"
          class="result-explorer__file-row"
          @click="openGroup(group)"
        >
          <v-icon icon="mdi-file-outline" size="22" class="result-explorer__file-icon" />
          <div class="result-explorer__file-info">
            <p class="result-explorer__file-name">{{ group.uploadFileName }}</p>
            <p class="mk-muted result-explorer__file-meta">
              画像 {{ group.images.length }}枚 ／ 検知 {{ group.detectedCount }}枚
              <span v-if="group.errorCount > 0" class="result-explorer__file-error">
                ／ エラー {{ group.errorCount }}件
              </span>
            </p>
          </div>
          <v-icon icon="mdi-chevron-right" size="20" class="mk-muted" />
        </button>
      </div>
    </div>

    <!-- レベル2: 画像サムネイル一覧 -->
    <div v-else-if="level === 'images' && selectedGroup" class="result-explorer__panel">
      <div class="result-explorer__panel-header">
        <p class="mk-muted">
          {{ selectedGroup.uploadFileName }} 内の画像（{{ selectedGroup.images.length }}枚）
        </p>
        <v-checkbox
          v-model="onlyDetected"
          label="検知ありのみ表示"
          density="compact"
          hide-details
        />
      </div>

      <div class="result-explorer__thumb-grid">
        <button
          v-for="image in visibleImages"
          :key="image.displayName"
          class="result-explorer__thumb"
          :class="{ 'result-explorer__thumb--error': image.error }"
          @click="openImage(image)"
        >
          <img
            v-if="thumbnailUrls[image.displayName]"
            :src="thumbnailUrls[image.displayName]"
            :alt="image.displayName"
            class="result-explorer__thumb-img"
          />
          <v-icon v-else icon="mdi-image-outline" size="28" class="mk-muted" />

          <span v-if="image.error" class="result-explorer__thumb-flag result-explorer__thumb-flag--error">
            エラー
          </span>
          <span
            v-else-if="(image.detectedFaceCount ?? 0) > 0 || (image.detectedTextCount ?? 0) > 0"
            class="result-explorer__thumb-flag"
          >
            検知あり
          </span>
          <span class="result-explorer__thumb-name">{{ relativePathWithinUploadFile(image.displayName) }}</span>
        </button>
      </div>
    </div>

    <!-- レベル3: before/after 詳細 -->
    <div v-else-if="level === 'detail' && selectedImage" class="result-explorer__panel">
      <div v-if="selectedImage.error" class="result-explorer__error-banner">
        <v-icon icon="mdi-alert-circle-outline" size="20" />
        {{ ERROR_LABELS[selectedImage.error] ?? `処理に失敗しました（${selectedImage.error}）` }}
      </div>

      <div v-else class="result-explorer__compare">
        <figure class="result-explorer__compare-item">
          <figcaption class="result-explorer__compare-label">Before（元画像）</figcaption>
          <div class="result-explorer__compare-frame">
            <img v-if="beforeImageUrl" :src="beforeImageUrl" alt="元画像" />
            <p v-else class="mk-muted result-explorer__compare-placeholder">
              元画像は表示できません<br />
              <small>（zip・PDF・Office 内の個別画像は元画像を取得できません）</small>
            </p>
          </div>
        </figure>

        <figure class="result-explorer__compare-item">
          <figcaption class="result-explorer__compare-label">After（マスキング後）</figcaption>
          <div class="result-explorer__compare-frame">
            <img v-if="afterImageUrl" :src="afterImageUrl" alt="マスキング後" />
            <v-progress-circular v-else-if="selectedImage.url && isBlobLoading(selectedImage.url)" indeterminate color="primary" />
            <p v-else class="mk-muted result-explorer__compare-placeholder">個人情報は検知されませんでした</p>
          </div>
        </figure>
      </div>


      <a
        v-if="selectedImage.url"
        class="mk-button result-explorer__download-btn"
        :href="afterImageUrl ?? undefined"
        :download="selectedImage.downloadName ?? selectedImage.displayName"
      >
        <v-icon icon="mdi-download" start size="18" />
        この画像だけダウンロード
      </a>
    </div>
  </div>
</template>

<style scoped>
.result-explorer {
  display: grid;
  gap: 1rem;
}

.result-explorer__summary {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.result-explorer__download-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.result-explorer__bundle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0.55rem 1.1rem;
  border-radius: var(--mk-rounded-sm);
  background: var(--mk-primary);
  color: #fff;
  border: none;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__bundle-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.result-explorer__expiry {
  font-size: 0.8rem;
}

.result-explorer__stat {
  flex: 1;
  min-width: 140px;
  background: var(--mk-background);
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-md);
  padding: 0.7rem 0.9rem;
}

.result-explorer__stat--error {
  border-color: var(--mk-error);
}

.result-explorer__stat-num {
  display: block;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--mk-primary);
}

.result-explorer__stat--error .result-explorer__stat-num {
  color: var(--mk-error);
}

.result-explorer__stat-label {
  display: block;
  font-size: 0.75rem;
  color: var(--mk-muted);
  margin-top: 0.15rem;
}

.result-explorer__breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  flex-wrap: wrap;
}

.result-explorer__crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  padding: 0.2rem 0.4rem;
  border-radius: 8px;
  color: var(--mk-muted);
  cursor: pointer;
  font-size: 0.85rem;
}

.result-explorer__crumb:hover {
  background: var(--mk-background);
}

.result-explorer__crumb--active {
  color: var(--mk-text);
  font-weight: 700;
  cursor: default;
}

.result-explorer__crumb--active:hover {
  background: none;
}

.result-explorer__crumb-sep {
  color: var(--mk-muted);
}

.result-explorer__panel {
  min-height: 320px;
}

.result-explorer__panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.result-explorer__empty {
  padding: 2rem 0;
  text-align: center;
}

.result-explorer__file-list {
  display: grid;
  gap: 0.6rem;
}

.result-explorer__file-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-md);
  background: #fff;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.result-explorer__file-row:hover {
  border-color: var(--mk-primary);
  background: rgba(0, 123, 167, 0.04);
}

.result-explorer__file-icon {
  color: var(--mk-primary);
  flex-shrink: 0;
}

.result-explorer__file-info {
  flex: 1;
  min-width: 0;
}

.result-explorer__file-name {
  margin: 0;
  font-weight: 700;
  word-break: break-all;
}

.result-explorer__file-meta {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
}

.result-explorer__file-error {
  color: var(--mk-error);
}

.result-explorer__thumb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.6rem;
}

.result-explorer__thumb {
  position: relative;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-sm);
  overflow: hidden;
  aspect-ratio: 1;
  background: var(--mk-background);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.result-explorer__thumb:hover {
  outline: 2px solid var(--mk-primary);
}

.result-explorer__thumb--error {
  border-color: var(--mk-error);
}

.result-explorer__thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-explorer__thumb-flag {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: var(--mk-primary);
  color: #fff;
}

.result-explorer__thumb-flag--error {
  background: var(--mk-error);
}

.result-explorer__thumb-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 0.62rem;
  padding: 0.15rem 0.3rem;
  background: rgba(23, 32, 42, 0.65);
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-explorer__error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.05rem;
  border-radius: var(--mk-rounded-md);
  background: rgba(196, 71, 71, 0.08);
  color: var(--mk-error);
  margin-bottom: 1rem;
}

.result-explorer__compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.result-explorer__compare-item {
  margin: 0;
}

.result-explorer__compare-frame {
  aspect-ratio: 4 / 3;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-md);
  background: var(--mk-background);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.result-explorer__compare-frame img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.result-explorer__compare-placeholder {
  text-align: center;
  font-size: 0.8rem;
  padding: 0 1rem;
}

.result-explorer__compare-label {
  font-size: 0.85rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  text-align: left;
}

.result-explorer__compare-item:first-child .result-explorer__compare-label {
  color: var(--mk-primary);
}

.result-explorer__compare-item:last-child .result-explorer__compare-label {
  color: var(--mk-success);
}


.result-explorer__download-btn {
  display: inline-flex;
  align-items: center;
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  border: 1px solid var(--mk-border);
  color: var(--mk-secondary);
  text-decoration: none;
}
</style>
