<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

import type { IntakePreUploadSummary, SelectedFilePreview } from "@/types/intake";

interface SelectedFileTile {
  extensionLabel: string;
  id: string;
  previewUrl: string | null;
  source: SelectedFilePreview;
}

const props = withDefaults(
  defineProps<{
    previews: SelectedFilePreview[];
    summary: IntakePreUploadSummary;
    surface?: boolean;
  }>(),
  {
    surface: true,
  },
);

const emit = defineEmits<{
  remove: [previewId: string];
}>();

const previewTiles = ref<SelectedFileTile[]>([]);

watch(
  () => props.previews,
  (previews) => {
    revokePreviewUrls(previewTiles.value);
    previewTiles.value = previews.map(createTile);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  revokePreviewUrls(previewTiles.value);
});

function itemClass(state: SelectedFilePreview["validationState"]): string {
  return state === "sendable" ? "selected-files__item--sendable" : "selected-files__item--blocked";
}

function itemAriaLabel(item: SelectedFilePreview, index: number): string {
  return `${index + 1} 件目、${item.fileName}、${item.sizeLabel}`;
}

function removeItem(previewId: string): void {
  emit("remove", previewId);
}

function createTile(preview: SelectedFilePreview): SelectedFileTile {
  return {
    extensionLabel: (preview.extension || "file").toUpperCase(),
    id: preview.id,
    previewUrl: isImagePreview(preview) ? URL.createObjectURL(preview.file) : null,
    source: preview,
  };
}

function isImagePreview(preview: SelectedFilePreview): boolean {
  return preview.extension === "png" || preview.extension === "jpg" || preview.extension === "jpeg";
}

function revokePreviewUrls(tiles: SelectedFileTile[]): void {
  for (const tile of tiles) {
    if (tile.previewUrl) {
      URL.revokeObjectURL(tile.previewUrl);
    }
  }
}
</script>

<template>
  <section class="selected-files" :class="{ 'mk-surface': surface, 'selected-files--embedded': !surface }">
    <header class="selected-files__header">
      <div>
        <h2 class="mk-section-title">アップロード対象</h2>
      </div>
      <span class="mk-muted">{{ props.previews.length }} 件</span>
    </header>

    <div v-if="props.previews.length === 0" class="mk-empty-state">
      アップロードできるファイルはまだありません。
    </div>

    <div v-else class="selected-files__list" role="list">
      <article
        v-for="(tile, index) in previewTiles"
        :key="tile.id"
        :aria-label="itemAriaLabel(tile.source, index)"
        class="selected-files__item"
        :class="itemClass(tile.source.validationState)"
        data-testid="selected-file-row"
        role="listitem"
        tabindex="0"
      >
        <div class="selected-files__preview" data-testid="selected-file-preview">
          <img
            v-if="tile.previewUrl"
            :alt="`${tile.source.fileName} のプレビュー`"
            class="selected-files__preview-image"
            :src="tile.previewUrl"
          >
          <div v-else class="selected-files__preview-fallback" data-testid="selected-file-preview-fallback">
            {{ tile.extensionLabel }}
          </div>
        </div>
        <div class="selected-files__meta">
          <div class="selected-files__file-labels">
            <span class="selected-files__order">{{ index + 1 }}</span>
            <strong>{{ tile.source.fileName }}</strong>
          </div>
          <span class="mk-muted">{{ tile.source.sizeLabel }} / .{{ tile.source.extension || 'unknown' }}</span>
        </div>
        <button
          type="button"
          class="selected-files__remove-button"
          :aria-label="`${tile.source.fileName} をアップロード対象から削除`"
          data-testid="selected-file-remove-button"
          @click.stop="removeItem(tile.source.id)"
        >
          <v-icon aria-hidden="true" icon="mdi-delete-outline" size="18" />
          <span>削除</span>
        </button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.selected-files {
  display: grid;
  gap: 1rem;
  padding: 1.2rem;
  border-radius: 22px;
}

.selected-files--embedded {
  padding: 0;
  border-radius: 0;
}

.selected-files__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1rem;
}

.selected-files__list {
  display: grid;
  gap: 0.8rem;
}

.selected-files__item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  gap: 0.85rem;
  align-items: center;
  padding: 0.95rem 1rem;
  border-radius: 18px;
  background: rgba(247, 250, 252, 0.88);
  border: 1px solid rgba(55, 88, 109, 0.1);
}

.selected-files__item--sendable {
  background: linear-gradient(135deg, rgba(47, 123, 98, 0.08), rgba(247, 250, 252, 0.92));
  border-color: rgba(47, 123, 98, 0.18);
}

.selected-files__item:focus-visible {
  outline: 3px solid rgba(47, 109, 138, 0.28);
  outline-offset: 4px;
}

.selected-files__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(215, 222, 232, 0.55);
  border: 1px solid rgba(55, 88, 109, 0.12);
}

.selected-files__preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.selected-files__preview-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--mk-accent-deep);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.selected-files__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
}

.selected-files__file-labels {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.selected-files__file-labels strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-files__order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 999px;
  background: rgba(55, 88, 109, 0.1);
  color: var(--mk-accent-deep);
  font-size: 0.76rem;
  font-weight: 700;
}

.selected-files__remove-button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 40px;
  padding: 0.5rem 0.7rem;
  border: 1px solid rgba(55, 88, 109, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--mk-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease, transform 140ms ease;
}

.selected-files__remove-button:hover,
.selected-files__remove-button:focus-visible {
  color: var(--mk-danger);
  border-color: rgba(181, 74, 58, 0.28);
  transform: translateY(-1px);
}

.selected-files__remove-button:focus-visible {
  outline: 3px solid rgba(181, 74, 58, 0.18);
  outline-offset: 3px;
}

@media (max-width: 560px) {
  .selected-files__item {
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 0.75rem;
  }

  .selected-files__preview {
    width: 56px;
    height: 56px;
  }

  .selected-files__remove-button {
    grid-column: 2;
    justify-self: start;
  }
}

</style>
