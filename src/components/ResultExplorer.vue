<script setup lang="ts">
// UI/UX要件書 4章「推奨する見せ方」: タスク→アップロードファイル→画像の段階的ドリルダウン。
// Googleドライブのフォルダ階層と同じく、同一エリアの表示内容が深く詳細になっていく単一ビュー遷移で実装する
// (3カラム同時表示ではなく、レベルを1つずつ切り替えてブレッドクラムで現在地を示す)。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import JSZip from 'jszip'
import { fetchGeneratedFileBlob } from '@/api/userApi'
import { useGeneratedFileBlobs } from '@/composables/useGeneratedFileBlobs'
import { useToast } from '@/composables/useToast'
import { fileKind, FILE_KIND_ICONS, fileTypeLabel } from '@/utils/fileKind'
import {
  groupFilesByUploadFile,
  relativePathWithinUploadFile,
  TERMINAL_STATUSES,
  type JobStatusResponse,
  type ProcessedImageFileResult,
  type UploadFileGroup,
} from '@/types/processJob'

const toast = useToast()

const props = defineProps<{
  jobStatus: JobStatusResponse
  token: string
  /** アップロード時にクライアントが保持していた元ファイル群。単一画像アップロード時のみ before 表示に使う。 */
  uploadedFiles: File[]
  /** モックの「ファイル一覧（{taskId}）へ戻る」表示用。 */
  taskId: string
}>()

type Level = 'files' | 'images' | 'detail'

const level = ref<Level>('files')
const selectedGroup = ref<UploadFileGroup | null>(null)
const selectedImage = ref<ProcessedImageFileResult | null>(null)

// レベル2(画像一覧)の検索・フィルタ・ページング。UI/UX要件2.7「ページング・絞り込みを考慮する」に対応。
type ImageFilter = 'detected' | 'all' | 'clear' | 'error'
const imageSearch = ref('')
const imageFilter = ref<ImageFilter>('detected')
const pageSize = ref(24)
const currentPage = ref(1)

const { resolve: resolveBlobUrl, isLoading: isBlobLoading } = useGeneratedFileBlobs(props.token)

const groups = computed(() => groupFilesByUploadFile(props.jobStatus.files))

// モックの task.mode==='mask' に相当。検知ありサムネイルのバッジを「マスク済み」/「検知あり」で切り替える。
const didMask = computed(() =>
  Boolean(props.jobStatus.executionParameters?.faceMask || props.jobStatus.executionParameters?.textMask),
)

/** モックの statusBadge('masked'/'detected') に相当。検知ありの場合のみ呼ぶ。 */
const detectedFlagLabel = computed(() => (didMask.value ? 'マスク済み' : '検知あり'))

/**
 * モックの file.status(completed/canceled/unprocessed)に相当する、ファイル単位の状態。
 * API はファイル単位の状態を持たないため、ジョブ全体の状態とグループ内画像の
 * 処理結果(url/errors の有無)から判定する。
 */
type FileRowStatus = 'completed' | 'canceled' | 'unprocessed' | 'inProgress'

function fileRowStatus(group: UploadFileGroup): FileRowStatus {
  // ジョブがまだ終端状態(TERMINAL_STATUSES)に達していない場合は、'completed'ではなく
  // 'inProgress'を返す。これを 'completed' 扱いにすると、まだ処理中/未着手のグループを
  // 開けてしまったり、誤って「完了」バッジを表示してしまう。
  if (!TERMINAL_STATUSES.includes(props.jobStatus.status)) return 'inProgress'
  if (props.jobStatus.status !== 'cancelled') return 'completed'
  const hasAnyResult = group.images.some((img) => img.url !== null || img.errors.length > 0)
  return hasAnyResult ? 'canceled' : 'unprocessed'
}

/** モックの canOpen(terminal && file.status !== 'unprocessed')に相当。 */
function canOpenGroup(group: UploadFileGroup): boolean {
  const status = fileRowStatus(group)
  return status !== 'unprocessed' && status !== 'inProgress'
}

const FILE_ROW_STATUS_META: Record<FileRowStatus, { label: string; badgeClass: string; icon: string }> = {
  completed: { label: '完了', badgeClass: 'result-explorer__badge--success', icon: 'mdi-check' },
  canceled: { label: 'キャンセル', badgeClass: 'result-explorer__badge--danger', icon: 'mdi-stop' },
  unprocessed: { label: '未処理', badgeClass: 'result-explorer__badge--neutral', icon: 'mdi-clock-outline' },
  inProgress: { label: '処理中', badgeClass: 'result-explorer__badge--neutral', icon: 'mdi-progress-clock' },
}

// 単一画像アップロード(zip/PDF/Office を介さない直接の画像1枚)の場合のみ、
// クライアント側に保持している元ファイルをそのまま before 画像として使える。
const isSingleImageUpload = computed(
  () => props.uploadedFiles.length === 1 && groups.value.length === 1 && groups.value[0].images.length === 1,
)

// フィルタ・検索を適用した後の一覧。ページングの母集団になる。
const filteredImages = computed(() => {
  if (!selectedGroup.value) return []
  let images = selectedGroup.value.images

  switch (imageFilter.value) {
    case 'detected':
      images = images.filter((img) => (img.detectedFaceCount ?? 0) > 0 || (img.detectedTextCount ?? 0) > 0)
      break
    case 'clear':
      images = images.filter(
        (img) => img.errors.length === 0 && (img.detectedFaceCount ?? 0) === 0 && (img.detectedTextCount ?? 0) === 0,
      )
      break
    case 'error':
      images = images.filter((img) => img.errors.length > 0)
      break
    case 'all':
      break
  }

  const query = imageSearch.value.trim().toLowerCase()
  if (query) {
    images = images.filter((img) => img.displayName.toLowerCase().includes(query))
  }

  return images
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredImages.value.length / pageSize.value)))

/** モックの pager(1 2 3 … の数字ボタン)に相当。ページ数が多い場合は現在ページ周辺のみ表示する。 */
const pageNumbers = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const maxButtons = 5
  if (total <= maxButtons) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  let start = Math.max(1, current - Math.floor(maxButtons / 2))
  const end = Math.min(total, start + maxButtons - 1)
  start = Math.max(1, end - maxButtons + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
})

// 現在のページに表示する画像。ドリルダウン内で使う一覧・ナビゲーション両方の母集団はページ内に限定する
// (UI/UX要件2.7「数万枚を1画面に表示するのは無理があるため、ページング・絞り込みを考慮」に対応)。
const visibleImages = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredImages.value.slice(start, start + pageSize.value)
})

watch([imageFilter, imageSearch, pageSize], () => {
  currentPage.value = 1
})

const beforeImageUrl = ref<string | null>(null)
// 単一画像アップロード時のみ、このコンポーネントが自前で URL.createObjectURL したURL。
// useGeneratedFileBlobs 経由のURL(こちらは既にキャッシュ管理されている)とは別に、
// 自分で作った分だけ責任を持って revokeObjectURL する。
let ownedBlobUrl: string | null = null
const afterImageUrl = ref<string | null>(null)
const thumbnailUrls = ref<Record<string, string>>({})
/** original.thumbnail(マスク前サムネイル)。取得できた画像だけ before/after 分割サムネイルを出す
 *  (モックの thumb.compare-thumb に相当)。 */
const beforeThumbnailUrls = ref<Record<string, string>>({})

type CompareMode = 'side' | 'before' | 'after' | 'overlay'
const compareMode = ref<CompareMode>('side')
const overlaySplit = ref(56)

// beforeImageUrl が取得できた(サーバー保持の original、または単一画像アップロード)場合のみ before を使うモードを提示する。
const canCompareBeforeAfter = computed(() => beforeImageUrl.value !== null)

const COMPARE_MODE_OPTIONS: { key: CompareMode; label: string; icon: string }[] = [
  { key: 'side', label: '並べて比較', icon: 'mdi-compare' },
  { key: 'before', label: '元画像', icon: 'mdi-image-outline' },
  { key: 'after', label: 'マスク済み', icon: 'mdi-eye-off-outline' },
  { key: 'overlay', label: '重ねて比較', icon: 'mdi-compare-horizontal' },
]

// ナビゲーション(前の画像/次の画像)は、現在のフィルタ・検索条件下の全体(ページを問わない)を対象にする。
const currentImageIndex = computed(() => {
  if (!selectedImage.value) return -1
  return filteredImages.value.findIndex((img) => img.displayName === selectedImage.value?.displayName)
})
const hasPrevImage = computed(() => currentImageIndex.value > 0)
const hasNextImage = computed(
  () => currentImageIndex.value >= 0 && currentImageIndex.value < filteredImages.value.length - 1,
)

function navigateImage(delta: number) {
  const nextIndex = currentImageIndex.value + delta
  const next = filteredImages.value[nextIndex]
  if (next) void openImage(next)
}

/** モックの image-title(item.name = ファイル名のみ)に相当。displayName の末尾セグメント。 */
function imageFileName(image: ProcessedImageFileResult): string {
  const segments = image.displayName.split('/')
  return segments[segments.length - 1]
}

function openGroup(group: UploadFileGroup) {
  selectedGroup.value = group
  selectedImage.value = null
  level.value = 'images'
  // モックの hashchange リセット(state.fileFilter='detected')に合わせ、ファイルを開くたびに絞り込みを初期化する
  imageFilter.value = 'detected'
  imageSearch.value = ''
  // imageFilter/imageSearch が直前の値から変化しない場合、watch([imageFilter, imageSearch, pageSize])
  // が発火せず currentPage がリセットされない。ここで明示的にリセットする。
  currentPage.value = 1
  void loadThumbnailsFor(group)
}

const isSavingMaskedImages = ref(false)

/** モックの safeName() に相当。ファイル名に使えない文字と空白をアンダースコアに置き換える。 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

/**
 * モックの「マスク画像を保存」(downloadBulk)に相当。バックエンドには1つのアップロード
 * ファイルだけに絞ったZIP生成エンドポイントが無いため、このファイルに含まれる
 * マスク済み画像を個別URLからクライアント側で取得し、JSZipでまとめてダウンロードさせる。
 */
async function saveMaskedImages(group: UploadFileGroup) {
  const maskedImages = group.images.filter((image) => image.url !== null)
  if (maskedImages.length === 0) {
    toast.error('保存できるマスク画像がありません')
    return
  }

  isSavingMaskedImages.value = true
  try {
    const zip = new JSZip()
    // 大量の画像を一度に fetch すると同時接続数を溢れさせてブラウザが固まるため、
    // 少数ずつ順に取得する(1枚ずつ zip.file() に追加し、メモリ上に一括保持しない)。
    const CONCURRENCY = 4
    let addedCount = 0
    for (let i = 0; i < maskedImages.length; i += CONCURRENCY) {
      const chunk = maskedImages.slice(i, i + CONCURRENCY)
      const chunkResults = await Promise.all(
        chunk.map(async (image) => {
          try {
            const blob = await fetchGeneratedFileBlob(image.url as string, props.token)
            return { image, blob }
          } catch {
            return { image, blob: null }
          }
        }),
      )
      for (const { image, blob } of chunkResults) {
        if (!blob) continue
        zip.file(relativePathWithinUploadFile(image.displayName), blob)
        addedCount++
      }
    }

    if (addedCount === 0) {
      toast.error('マスク画像の取得に失敗しました')
      return
    }

    // generateAsync は圧縮処理が重いため、UIスレッドを塞がないよう非同期実行に任せる
    // (JSZip 内部で Promise チェーンに分割されるので、await するだけでよい)。
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const objectUrl = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = objectUrl
    // モックの `masky_${task.id}_${safeName(file.name)}_masked.zip` と同じ命名規則。
    link.download = `masky_${safeName(props.taskId)}_${safeName(group.uploadFileName)}_masked.zip`
    link.click()
    URL.revokeObjectURL(objectUrl)

    toast.success('ZIPを作成しました', `${addedCount}件のマスク画像を収録しています`)
  } catch (err) {
    toast.error('ZIPの作成に失敗しました', err instanceof Error ? err.message : String(err))
  } finally {
    isSavingMaskedImages.value = false
  }
}

async function loadThumbnailsFor(group: UploadFileGroup) {
  // 並列かつ独立に取得する。1枚のサムネイル取得が失敗しても、他の画像のサムネイルは
  // 取得を続ける(逐次awaitだと1枚の失敗でそれ以降の画像が全て取得されなくなっていた)。
  await Promise.all(
    group.images.map(async (image) => {
      const key = image.displayName
      const tasks: Promise<void>[] = []

      if (!thumbnailUrls.value[key] && image.thumbnail?.url) {
        tasks.push(
          resolveBlobUrl(image.thumbnail.url)
            .then((url) => {
              if (url) thumbnailUrls.value = { ...thumbnailUrls.value, [key]: url }
            })
            .catch(() => {
              // このサムネイルは取得失敗として諦める(サムネイルなし表示にフォールバック)
            }),
        )
      }

      if (!beforeThumbnailUrls.value[key] && image.original?.thumbnail?.url) {
        tasks.push(
          resolveBlobUrl(image.original.thumbnail.url)
            .then((url) => {
              if (url) beforeThumbnailUrls.value = { ...beforeThumbnailUrls.value, [key]: url }
            })
            .catch(() => {
              // before サムネイルが無くても after 単独のサムネイル表示にフォールバックする
            }),
        )
      }

      await Promise.all(tasks)
    }),
  )
}

async function openImage(image: ProcessedImageFileResult) {
  selectedImage.value = image
  level.value = 'detail'
  afterImageUrl.value = null
  beforeImageUrl.value = null
  compareMode.value = 'side'
  overlaySplit.value = 56

  if (image.url) {
    afterImageUrl.value = await resolveBlobUrl(image.url)
  }

  // サーバーが保持している未マスキング元画像(README: files[*].original)を優先する。
  // zip/PDF/Office 由来の画像でもこれで Before 表示ができる。
  // 無い場合のみ、単一画像アップロード時に限りクライアント側の元ファイルにフォールバックする。
  if (image.original?.url) {
    beforeImageUrl.value = await resolveBlobUrl(image.original.url)
  } else if (isSingleImageUpload.value && props.uploadedFiles[0]) {
    // 自分で作成した直前のURLが残っていれば解放してから、新しいURLを作る
    // (useGeneratedFileBlobs 経由のURLはキャッシュ管理されているため、ここでは触らない)。
    if (ownedBlobUrl) {
      URL.revokeObjectURL(ownedBlobUrl)
      ownedBlobUrl = null
    }
    const objectUrl = URL.createObjectURL(props.uploadedFiles[0])
    ownedBlobUrl = objectUrl
    beforeImageUrl.value = objectUrl
  }
}

onBeforeUnmount(() => {
  if (ownedBlobUrl) {
    URL.revokeObjectURL(ownedBlobUrl)
    ownedBlobUrl = null
  }
})

function backToFiles() {
  level.value = 'files'
  selectedGroup.value = null
  selectedImage.value = null
}

function backToImages() {
  level.value = 'images'
  selectedImage.value = null
}

// ジョブが切り替わったら(結果が新しくなったら)ドリルダウン状態を先頭に戻す
watch(
  () => props.jobStatus,
  () => backToFiles(),
)

// 親(TaskResultsBrowser.vue)が3段のFlowNav(タスク→ファイル→画像)を表示するために、
// 現在の階層と選択中の名前を読み取れるようにする。
defineExpose({ level, selectedGroup, selectedImage, backToFiles, backToImages })
</script>

<template>
  <div class="result-explorer">
    <!-- レベル1: アップロードファイル一覧(モックの renderTaskDetail テーブルに相当) -->
    <div v-if="level === 'files'" class="result-explorer__panel">
      <div v-if="groups.length === 0" class="mk-muted result-explorer__empty">
        表示できる画像がありません。
      </div>
      <div v-else class="result-explorer__table-wrap">
        <table class="result-explorer__table">
          <thead>
            <tr>
              <th>アップロードファイル</th>
              <th class="result-explorer__table-num">画像数</th>
              <th class="result-explorer__table-num">個人情報あり</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in groups"
              :key="group.uploadFileName"
              :class="{ 'result-explorer__table-row--clickable': canOpenGroup(group) }"
              @click="canOpenGroup(group) && openGroup(group)"
            >
              <td>
                <div class="result-explorer__file-cell">
                  <div class="result-explorer__file-icon" :class="fileKind(group.uploadFileName)">
                    <v-icon :icon="FILE_KIND_ICONS[fileKind(group.uploadFileName)]" size="20" />
                  </div>
                  <div class="min-w-0">
                    <div class="result-explorer__cell-main" :title="group.uploadFileName">{{ group.uploadFileName }}</div>
                    <div class="mk-muted result-explorer__cell-sub">{{ fileTypeLabel(group.uploadFileName) }}</div>
                  </div>
                </div>
              </td>
              <td class="result-explorer__table-num">
                <div class="result-explorer__cell-main">{{ group.images.length }}</div>
              </td>
              <td class="result-explorer__table-num" :class="{ 'result-explorer__detect-cell--hit': group.detectedCount > 0 }">
                <strong>{{ group.detectedCount }}</strong>
                <div class="result-explorer__cell-note">目{{ group.faceCount }} ・ 文字{{ group.textCount }}</div>
              </td>
              <td>
                <span class="result-explorer__badge" :class="FILE_ROW_STATUS_META[fileRowStatus(group)].badgeClass">
                  <v-icon :icon="FILE_ROW_STATUS_META[fileRowStatus(group)].icon" size="13" />
                  {{ FILE_ROW_STATUS_META[fileRowStatus(group)].label }}
                </span>
                <div v-if="group.errorCount > 0" class="result-explorer__cell-sub result-explorer__file-error">
                  {{ group.errorCount }}件のエラー
                </div>
              </td>
              <td>
                <button v-if="canOpenGroup(group)" type="button" class="result-explorer__link-btn" @click.stop="openGroup(group)">
                  画像を見る
                  <v-icon icon="mdi-chevron-right" size="16" />
                </button>
                <span v-else class="result-explorer__badge result-explorer__badge--neutral">未実行</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- レベル2: 画像サムネイル一覧 -->
    <div v-else-if="level === 'images' && selectedGroup" class="result-explorer__panel">
      <button type="button" class="result-explorer__back-link" @click="backToFiles">
        <v-icon icon="mdi-chevron-left" size="16" />
        ファイル一覧（{{ taskId }}）へ戻る
      </button>

      <!-- ファイル要約バー(モックの file-summary-bar に相当) -->
      <div class="result-explorer__file-summary-bar">
        <div class="result-explorer__file-summary-name">
          <div class="result-explorer__file-icon" :class="fileKind(selectedGroup.uploadFileName)">
            <v-icon :icon="FILE_KIND_ICONS[fileKind(selectedGroup.uploadFileName)]" size="20" />
          </div>
          <p class="result-explorer__file-summary-title">{{ selectedGroup.uploadFileName }}</p>
        </div>
        <div class="result-explorer__file-summary-stats">
          <div class="result-explorer__fss">
            <span>画像数</span>
            <strong>{{ selectedGroup.images.length }}</strong>
          </div>
          <div class="result-explorer__fss" :class="{ 'result-explorer__fss--hit': selectedGroup.detectedCount > 0 }">
            <span>個人情報あり</span>
            <strong>{{ selectedGroup.detectedCount }}</strong>
          </div>
          <div class="result-explorer__fss">
            <span>目 / 文字</span>
            <strong>{{ selectedGroup.faceCount }} / {{ selectedGroup.textCount }}</strong>
          </div>
        </div>
        <button
          type="button"
          class="result-explorer__save-btn"
          :disabled="!selectedGroup.images.some((img) => img.url !== null) || isSavingMaskedImages"
          @click="saveMaskedImages(selectedGroup)"
        >
          <v-progress-circular v-if="isSavingMaskedImages" indeterminate size="16" width="2" />
          <v-icon v-else icon="mdi-download" size="16" />
          マスク画像を保存
        </button>
      </div>

      <!-- 検索・絞り込み(UI/UX要件2.7: ページング・絞り込みを考慮する) -->
      <div class="result-explorer__toolbar">
        <v-text-field
          v-model="imageSearch"
          placeholder="画像名・内部パスを検索"
          density="compact"
          hide-details
          prepend-inner-icon="mdi-magnify"
          class="result-explorer__search"
        />
        <v-select
          v-model="imageFilter"
          :items="[
            { title: '個人情報あり', value: 'detected' },
            { title: 'すべての画像', value: 'all' },
            { title: '検知なし', value: 'clear' },
            { title: 'エラー', value: 'error' },
          ]"
          density="compact"
          hide-details
          class="result-explorer__filter"
        />
        <span class="mk-muted result-explorer__count">{{ filteredImages.length }}件</span>
      </div>

      <div v-if="filteredImages.length === 0" class="result-explorer__empty">
        <div>
          <div class="result-explorer__empty-icon">
            <v-icon icon="mdi-image-outline" size="24" />
          </div>
          <h3>該当する画像がありません</h3>
          <p>絞り込み条件または検索語を変更してください。</p>
        </div>
      </div>

      <div v-else class="result-explorer__thumb-grid">
        <button
          v-for="image in visibleImages"
          :key="image.displayName"
          class="result-explorer__thumb"
          :class="{ 'result-explorer__thumb--error': image.errors.length > 0 }"
          @click="openImage(image)"
        >
          <!-- マスク前サムネイルが取得できた場合は Before/After 分割表示にする(モックの thumb.compare-thumb 相当) -->
          <div
            v-if="beforeThumbnailUrls[image.displayName] && thumbnailUrls[image.displayName]"
            class="result-explorer__thumb-image-wrap result-explorer__thumb-image-wrap--split"
          >
            <div class="result-explorer__thumb-half">
              <img :src="beforeThumbnailUrls[image.displayName]" :alt="`${image.displayName}のマスク前サムネイル`" class="result-explorer__thumb-img" />
              <span class="result-explorer__thumb-half-label">Before</span>
            </div>
            <div class="result-explorer__thumb-half">
              <img :src="thumbnailUrls[image.displayName]" :alt="`${image.displayName}のマスク後サムネイル`" class="result-explorer__thumb-img" />
              <span class="result-explorer__thumb-half-label">After</span>
            </div>
            <span v-if="image.errors.length > 0" class="result-explorer__thumb-flag result-explorer__thumb-flag--error">
              エラー
            </span>
            <span
              v-else-if="(image.detectedFaceCount ?? 0) > 0 || (image.detectedTextCount ?? 0) > 0"
              class="result-explorer__thumb-flag"
            >
              {{ detectedFlagLabel }}
            </span>
          </div>
          <div v-else class="result-explorer__thumb-image-wrap">
            <img
              v-if="thumbnailUrls[image.displayName]"
              :src="thumbnailUrls[image.displayName]"
              :alt="image.displayName"
              class="result-explorer__thumb-img"
            />
            <v-icon v-else icon="mdi-image-outline" size="28" class="mk-muted" />

            <span v-if="image.errors.length > 0" class="result-explorer__thumb-flag result-explorer__thumb-flag--error">
              エラー
            </span>
            <span
              v-else-if="(image.detectedFaceCount ?? 0) > 0 || (image.detectedTextCount ?? 0) > 0"
              class="result-explorer__thumb-flag"
            >
              {{ detectedFlagLabel }}
            </span>
          </div>
          <div class="result-explorer__thumb-body">
            <span class="result-explorer__thumb-name">{{ imageFileName(image) }}</span>
            <span class="result-explorer__thumb-origin">
              <v-icon icon="mdi-map-marker-path" size="12" />
              <span>{{ relativePathWithinUploadFile(image.displayName) }}</span>
            </span>
            <div class="result-explorer__thumb-foot">
              <div class="result-explorer__thumb-badges">
                <span v-if="(image.detectedFaceCount ?? 0) > 0" class="result-explorer__badge result-explorer__badge--neutral">
                  <v-icon icon="mdi-eye-outline" size="12" />
                  目 {{ image.detectedFaceCount }}
                </span>
                <span v-if="(image.detectedTextCount ?? 0) > 0" class="result-explorer__badge result-explorer__badge--neutral">
                  <v-icon icon="mdi-format-text" size="12" />
                  文字 {{ image.detectedTextCount }}
                </span>
                <span
                  v-if="(image.detectedFaceCount ?? 0) === 0 && (image.detectedTextCount ?? 0) === 0"
                  class="result-explorer__badge result-explorer__badge--neutral"
                >
                  検知なし
                </span>
              </div>
              <span
                v-if="image.errors.length === 0 && ((image.detectedFaceCount ?? 0) > 0 || (image.detectedTextCount ?? 0) > 0)"
                class="result-explorer__thumb-cta"
              >
                <v-icon icon="mdi-compare-horizontal" size="13" />
                並べて比較
              </span>
            </div>
          </div>
        </button>
      </div>

      <!-- ページング(UI/UX要件2.7: 数万枚を1画面に表示するのは無理があるため考慮する)。
           モックの pagination は絞り込み結果が0件でも常に表示し「0件」と出す(他の一覧画面と揃える)。 -->
      <div class="result-explorer__pagination">
        <span class="mk-muted result-explorer__pagination-info">
          {{
            filteredImages.length === 0
              ? '0件'
              : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filteredImages.length)} / ${filteredImages.length}件`
          }}
        </span>
        <div class="result-explorer__pagination-controls">
          <v-select
            v-model="pageSize"
            :items="[
              { title: '24件/ページ', value: 24 },
              { title: '48件/ページ', value: 48 },
              { title: '96件/ページ', value: 96 },
            ]"
            density="compact"
            hide-details
            class="result-explorer__page-size"
          />
          <div class="result-explorer__pager">
            <button
              class="result-explorer__page-btn"
              :disabled="currentPage <= 1"
              @click="currentPage--"
            >
              <v-icon icon="mdi-chevron-left" size="18" />
            </button>
            <button
              v-for="page in pageNumbers"
              :key="page"
              class="result-explorer__page-btn"
              :class="{ 'result-explorer__page-btn--active': page === currentPage }"
              @click="currentPage = page"
            >
              {{ page }}
            </button>
            <button
              class="result-explorer__page-btn"
              :disabled="currentPage >= totalPages"
              @click="currentPage++"
            >
              <v-icon icon="mdi-chevron-right" size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- レベル3: before/after 詳細 -->
    <div v-else-if="level === 'detail' && selectedImage" class="result-explorer__panel">
      <div class="result-explorer__detail-layout">
        <!-- 左: 画像比較エリア -->
        <div class="result-explorer__detail-stage">
          <div v-if="selectedImage.errors.length > 0" class="result-explorer__error-banner">
            <v-icon icon="mdi-alert-circle-outline" size="20" />
            <div>
              <div v-for="err in selectedImage.errors" :key="err.id">{{ err.message }}</div>
            </div>
          </div>

          <template v-else>
            <!-- 比較モードスイッチ(before 画像が取得できる場合のみ複数モードを提示) -->
            <div v-if="canCompareBeforeAfter && afterImageUrl" class="result-explorer__mode-switch" role="group" aria-label="画像の比較方法">
              <button
                v-for="opt in COMPARE_MODE_OPTIONS"
                :key="opt.key"
                type="button"
                class="result-explorer__mode-btn"
                :class="{ 'result-explorer__mode-btn--active': compareMode === opt.key }"
                @click="compareMode = opt.key"
              >
                <v-icon :icon="opt.icon" size="16" />
                {{ opt.label }}
              </button>
            </div>

            <!-- 並べて比較 -->
            <div
              v-if="!canCompareBeforeAfter || !afterImageUrl || compareMode === 'side'"
              class="result-explorer__compare"
            >
              <figure class="result-explorer__compare-item">
                <figcaption class="result-explorer__compare-label">Before（元画像）</figcaption>
                <div class="result-explorer__compare-frame">
                  <img v-if="beforeImageUrl" :src="beforeImageUrl" alt="元画像" />
                  <v-progress-circular v-else-if="selectedImage.original?.url" indeterminate color="primary" />
                  <p v-else class="mk-muted result-explorer__compare-placeholder">
                    元画像は保持されていません
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

            <!-- 元画像のみ -->
            <div v-else-if="compareMode === 'before'" class="result-explorer__compare result-explorer__compare--single">
              <figure class="result-explorer__compare-item">
                <figcaption class="result-explorer__compare-label">Before（元画像）</figcaption>
                <div class="result-explorer__compare-frame">
                  <img :src="beforeImageUrl!" alt="元画像" />
                </div>
              </figure>
            </div>

            <!-- マスク済みのみ -->
            <div v-else-if="compareMode === 'after'" class="result-explorer__compare result-explorer__compare--single">
              <figure class="result-explorer__compare-item">
                <figcaption class="result-explorer__compare-label">After（マスキング後）</figcaption>
                <div class="result-explorer__compare-frame">
                  <img :src="afterImageUrl!" alt="マスキング後" />
                </div>
              </figure>
            </div>

            <!-- 重ねて比較(スライダー) -->
            <div v-else-if="compareMode === 'overlay'" class="result-explorer__overlay">
              <div class="result-explorer__overlay-view" :style="{ '--split': overlaySplit + '%' }">
                <img :src="beforeImageUrl!" alt="マスク前" />
                <img class="result-explorer__overlay-after" :src="afterImageUrl!" alt="マスク後" />
                <span class="result-explorer__overlay-label result-explorer__overlay-label--before">Before</span>
                <span class="result-explorer__overlay-label result-explorer__overlay-label--after">After</span>
                <span class="result-explorer__overlay-divider" />
              </div>
              <input
                v-model.number="overlaySplit"
                type="range"
                min="0"
                max="100"
                class="result-explorer__overlay-slider"
                aria-label="マスク前後の比較位置"
              />
            </div>
          </template>
        </div>

        <!-- 右: メタ情報パネル -->
        <aside class="result-explorer__detail-meta">
          <div class="result-explorer__image-nav">
            <button
              type="button"
              class="mk-button-outline result-explorer__image-nav-btn"
              :disabled="!hasPrevImage"
              @click="navigateImage(-1)"
            >
              <v-icon icon="mdi-chevron-left" size="16" />
              前の画像
            </button>
            <span class="result-explorer__image-nav-index">
              {{ filteredImages.length ? currentImageIndex + 1 : 0 }} / {{ filteredImages.length }}
            </span>
            <button
              type="button"
              class="mk-button-outline result-explorer__image-nav-btn"
              :disabled="!hasNextImage"
              @click="navigateImage(1)"
            >
              次の画像
              <v-icon icon="mdi-chevron-right" size="16" />
            </button>
          </div>

          <div class="result-explorer__meta-section">
            <h4>由来ファイル・位置</h4>
            <div class="result-explorer__meta-row">
              <span>アップロードファイル</span>
              <strong>{{ selectedGroup?.uploadFileName }}</strong>
            </div>
            <div class="result-explorer__meta-row">
              <span>ファイル内の位置</span>
              <strong>{{ relativePathWithinUploadFile(selectedImage.displayName) }}</strong>
            </div>
          </div>

          <div class="result-explorer__meta-section">
            <h4>検知結果</h4>
            <div class="result-explorer__detection-item" v-if="(selectedImage.detectedFaceCount ?? 0) > 0">
              <span><v-icon icon="mdi-eye-outline" size="16" />目の領域</span>
              <strong>{{ selectedImage.detectedFaceCount }}件</strong>
            </div>
            <div class="result-explorer__detection-item" v-if="(selectedImage.detectedTextCount ?? 0) > 0">
              <span><v-icon icon="mdi-format-text" size="16" />文字パターン</span>
              <strong>{{ selectedImage.detectedTextCount }}件</strong>
            </div>
            <div
              class="result-explorer__detection-item"
              v-if="(selectedImage.detectedFaceCount ?? 0) === 0 && (selectedImage.detectedTextCount ?? 0) === 0"
            >
              <span><v-icon icon="mdi-check" size="16" />個人情報</span>
              <strong>0件</strong>
            </div>
          </div>

          <div class="result-explorer__meta-section">
            <v-alert type="info" variant="tonal" density="compact" text="検出・マスクは全自動です。マスク位置の手動修正はできません。" />
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
        </aside>
      </div>
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

.result-explorer__back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mk-muted);
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__back-link:hover {
  color: var(--mk-primary);
}

.result-explorer__panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.result-explorer__file-summary-bar {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  flex-wrap: wrap;
  padding: 0.9rem 1rem;
  margin-bottom: 0.9rem;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-md);
  background: #fff;
}

.result-explorer__file-summary-name {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
  flex: 1;
}

.result-explorer__file-summary-title {
  margin: 0;
  font-weight: 700;
  word-break: break-all;
}

.result-explorer__file-summary-stats {
  display: flex;
  gap: 1.4rem;
  flex-wrap: wrap;
}

.result-explorer__fss {
  text-align: center;
}

.result-explorer__fss span {
  display: block;
  color: var(--mk-muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.result-explorer__fss strong {
  display: block;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -.02em;
}

.result-explorer__fss--hit strong {
  color: #b05e0a;
}

.result-explorer__save-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid var(--mk-border);
  border-radius: 9px;
  background: #fff;
  color: var(--mk-text);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__save-btn:hover:not(:disabled) {
  border-color: var(--mk-primary);
  color: var(--mk-primary);
}

.result-explorer__save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.result-explorer__toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}

.result-explorer__search {
  flex: 1;
  min-width: 200px;
}

.result-explorer__filter {
  width: 160px;
  flex: 0 0 auto;
}

.result-explorer__count {
  font-size: 0.8rem;
  white-space: nowrap;
}

.result-explorer__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--mk-border);
}

.result-explorer__pagination-info {
  font-size: 0.8rem;
}

.result-explorer__pagination-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.result-explorer__page-size {
  width: 130px;
}

.result-explorer__pager {
  display: flex;
  align-items: center;
  gap: 4px;
}

.result-explorer__page-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border: 1px solid var(--mk-border);
  border-radius: 8px;
  background: #fff;
  color: var(--mk-text);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__page-btn:hover:not(:disabled) {
  background: var(--mk-background);
}

.result-explorer__page-btn--active {
  color: var(--mk-primary);
  background: rgba(0, 123, 167, 0.08);
  border-color: rgba(0, 123, 167, 0.3);
}

.result-explorer__page-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.result-explorer__empty {
  min-height: 240px;
  padding: 30px;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--mk-muted);
}

.result-explorer__empty-icon {
  width: 54px;
  height: 54px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  color: var(--mk-muted);
  background: #f0f3f8;
}

.result-explorer__empty h3 {
  margin: 0;
  font-size: 16.5px;
  color: var(--mk-text);
}

.result-explorer__empty p {
  margin: 7px auto 0;
  max-width: 460px;
  color: var(--mk-muted);
  font-size: 13.5px;
}

.result-explorer__table-wrap {
  width: 100%;
  overflow-x: auto;
}

.result-explorer__table {
  width: 100%;
  border-collapse: collapse;
}

.result-explorer__table th {
  padding: 10px 14px;
  border-bottom: 1px solid var(--mk-border);
  color: var(--mk-muted);
  font-size: 0.75rem;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.result-explorer__table td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--mk-border);
  vertical-align: middle;
}

.result-explorer__table th.result-explorer__table-num,
.result-explorer__table td.result-explorer__table-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.result-explorer__table-row--clickable {
  cursor: pointer;
}

.result-explorer__table-row--clickable:hover {
  background: rgba(0, 123, 167, 0.04);
}

.result-explorer__file-cell {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 260px;
}

.result-explorer__cell-main {
  font-weight: 750;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-explorer__cell-sub {
  margin-top: 2px;
  font-size: 0.75rem;
}

.result-explorer__cell-note {
  margin-top: 2px;
  color: var(--mk-muted);
  font-size: 0.75rem;
}

.result-explorer__detect-cell--hit strong {
  font-size: 1.05rem;
  font-weight: 800;
  color: #b05e0a;
}

.result-explorer__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
}

.result-explorer__badge--success {
  color: var(--mk-success);
  background: rgba(47, 125, 74, 0.1);
}

.result-explorer__badge--danger {
  color: var(--mk-error);
  background: rgba(196, 71, 71, 0.1);
}

.result-explorer__badge--neutral {
  color: var(--mk-muted);
  background: rgba(0, 0, 0, 0.05);
}

.result-explorer__link-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--mk-primary);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__file-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 10px;
  color: var(--mk-primary);
  background: rgba(0, 123, 167, 0.08);
}

.result-explorer__file-icon.zip {
  color: #7b58b5;
  background: #f1eafa;
}

.result-explorer__file-icon.pdf {
  color: #c34d58;
  background: #fff0f1;
}

.result-explorer__file-icon.office {
  color: #2d78a5;
  background: #e9f5fb;
}

.result-explorer__file-icon.image {
  color: #16836a;
  background: #e4f7f2;
}

.result-explorer__file-error {
  color: var(--mk-error);
}

.result-explorer__thumb-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
}

@media (max-width: 900px) {
  .result-explorer__thumb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.result-explorer__thumb {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-sm);
  overflow: hidden;
  background: #fff;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition: border-color .15s, box-shadow .15s;
}

.result-explorer__thumb:hover {
  border-color: var(--mk-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, .08);
}

.result-explorer__thumb--error {
  border-color: var(--mk-error);
}

.result-explorer__thumb-image-wrap {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mk-background);
}

.result-explorer__thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-explorer__thumb-image-wrap--split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  background: #c9d2df;
}

.result-explorer__thumb-half {
  position: relative;
  min-width: 0;
  overflow: hidden;
  background: var(--mk-background);
}

.result-explorer__thumb-half-label {
  position: absolute;
  left: 5px;
  bottom: 5px;
  min-height: 18px;
  padding: 2px 6px;
  border-radius: 6px;
  color: #fff;
  background: rgba(15, 23, 42, .78);
  font-size: 0.58rem;
  font-weight: 800;
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

.result-explorer__thumb-body {
  padding: 0.4rem 0.5rem;
  display: grid;
  gap: 0.2rem;
}

.result-explorer__thumb-name {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--mk-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-explorer__thumb-origin {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  color: var(--mk-muted);
  font-size: 0.62rem;
}

.result-explorer__thumb-origin span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-explorer__thumb-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
}

.result-explorer__thumb-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.result-explorer__thumb-badges .result-explorer__badge {
  padding: 1px 6px;
  font-size: 0.6rem;
}

.result-explorer__thumb-cta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--mk-primary);
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

/* ---------- レベル3: 詳細画面(比較モード・ナビゲーション・メタパネル) ---------- */
.result-explorer__detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 1rem;
  align-items: start;
}

.result-explorer__detail-stage {
  min-width: 0;
}

.result-explorer__compare--single {
  grid-template-columns: 1fr;
  max-width: 560px;
  margin: 0 auto;
}

.result-explorer__mode-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  margin-bottom: 0.9rem;
  border-radius: 11px;
  background: var(--mk-background);
  border: 1px solid var(--mk-border);
}

.result-explorer__mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 11px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mk-muted);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.result-explorer__mode-btn:hover {
  color: var(--mk-text);
  background: rgba(0, 0, 0, 0.04);
}

.result-explorer__mode-btn--active {
  color: #fff;
  background: var(--mk-primary);
}

.result-explorer__overlay {
  display: grid;
  gap: 0.75rem;
}

.result-explorer__overlay-view {
  --split: 56%;
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: var(--mk-rounded-md);
  background: #111827;
}

.result-explorer__overlay-view img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0f172a;
}

.result-explorer__overlay-after {
  clip-path: inset(0 calc(100% - var(--split)) 0 0);
}

.result-explorer__overlay-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--split);
  width: 2px;
  transform: translateX(-1px);
  background: #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.result-explorer__overlay-label {
  position: absolute;
  top: 10px;
  padding: 5px 9px;
  border-radius: 7px;
  color: #fff;
  background: rgba(13, 23, 39, 0.74);
  font-size: 0.7rem;
  font-weight: 700;
}

.result-explorer__overlay-label--before {
  left: 10px;
}

.result-explorer__overlay-label--after {
  right: 10px;
}

.result-explorer__overlay-slider {
  width: 100%;
}

.result-explorer__detail-meta {
  display: grid;
  gap: 0;
  align-content: start;
  border: 1px solid var(--mk-border);
  border-radius: var(--mk-rounded-md);
  background: #fff;
  padding: 1rem;
}

.result-explorer__image-nav {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.9rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid var(--mk-border);
}

.result-explorer__image-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  padding: 5px 8px;
  font-size: 0.72rem;
  font-weight: 700;
  border-radius: 8px;
  border: 1px solid var(--mk-border);
  background: #fff;
  color: var(--mk-text);
  cursor: pointer;
  white-space: nowrap;
}

.result-explorer__image-nav-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.result-explorer__image-nav-index {
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--mk-muted);
  white-space: nowrap;
}

.result-explorer__meta-section {
  padding-bottom: 0.9rem;
  margin-bottom: 0.9rem;
  border-bottom: 1px solid var(--mk-border);
}

.result-explorer__meta-section:last-of-type {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.result-explorer__meta-section h4 {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: var(--mk-muted);
}

.result-explorer__meta-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
  padding: 0.3rem 0;
}

.result-explorer__meta-row span {
  color: var(--mk-muted);
}

.result-explorer__meta-row strong {
  text-align: right;
  overflow-wrap: anywhere;
}

.result-explorer__detection-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.4rem;
  border: 1px solid var(--mk-border);
  border-radius: 8px;
  background: var(--mk-background);
  font-size: 0.78rem;
}

.result-explorer__detection-item span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

@media (max-width: 900px) {
  .result-explorer__detail-layout {
    grid-template-columns: 1fr;
  }
}
</style>
