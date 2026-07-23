import { onBeforeUnmount, ref } from 'vue'
import { fetchGeneratedFileBlob } from '@/api/userApi'

/** サムネイル・処理済み画像の Blob URL を取得してキャッシュする。
 *  同じ URL への再リクエストを避け、アンマウント時に Object URL を一括解放する。 */
export function useGeneratedFileBlobs(token: string) {
  const cache = new Map<string, string>()
  const loading = ref<Set<string>>(new Set())

  async function resolve(rawUrl: string | null): Promise<string | null> {
    if (!rawUrl) return null
    const cached = cache.get(rawUrl)
    if (cached) return cached

    loading.value.add(rawUrl)
    try {
      const blob = await fetchGeneratedFileBlob(rawUrl, token)
      const objectUrl = URL.createObjectURL(blob)
      cache.set(rawUrl, objectUrl)
      return objectUrl
    } finally {
      loading.value.delete(rawUrl)
    }
  }

  function isLoading(rawUrl: string | null): boolean {
    return rawUrl !== null && loading.value.has(rawUrl)
  }

  onBeforeUnmount(() => {
    for (const objectUrl of cache.values()) {
      URL.revokeObjectURL(objectUrl)
    }
    cache.clear()
  })

  return { resolve, isLoading }
}
