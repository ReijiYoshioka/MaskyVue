<script setup lang="ts">
import { computed, ref } from "vue";

import MkButton from "@/components/ui/MkButton.vue";
import type { IntakePreUploadSummary } from "@/types/intake";

const props = withDefaults(
  defineProps<{
    disabled: boolean;
    summary: IntakePreUploadSummary;
    surface?: boolean;
  }>(),
  {
    surface: true,
  },
);

const emit = defineEmits<{
  filesSelected: [files: File[]];
}>();

const dragActive = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const shouldShowRequest = computed(
  () =>
    props.summary.selectedCount + props.summary.blockedCount > 0 &&
    (props.summary.blockedCount > 0 || !props.summary.canSubmitRequest),
);

function openPicker(): void {
  if (props.disabled) return;
  fileInput.value?.click();
}

function handleInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  if (files.length > 0) {
    emit("filesSelected", files);
  }
  target.value = "";
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  if (props.disabled) return;
  dragActive.value = true;
}

function handleDragLeave(): void {
  dragActive.value = false;
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  dragActive.value = false;
  if (props.disabled) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) {
    emit("filesSelected", files);
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  openPicker();
}
</script>

<template>
  <section
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    class="drop-zone"
    :class="{
      'mk-surface': surface,
      'drop-zone--active': dragActive,
      'drop-zone--disabled': disabled,
      'drop-zone--embedded': !surface,
    }"
    data-testid="file-drop-zone"
    role="button"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @keydown="handleKeydown"
  >
    <div class="drop-zone__content">
      <p v-if="summary.selectedCount + summary.blockedCount > 0" class="drop-zone__status">
        {{ summary.selectedCountLabel }}
      </p>
    </div>

    <section
      v-if="shouldShowRequest"
      class="drop-zone__request"
      :class="`drop-zone__request--${summary.requestTone}`"
    >
      <strong>{{ summary.requestTitle }}</strong>
      <p v-if="summary.requestMessage">{{ summary.requestMessage }}</p>
    </section>

    <div class="drop-zone__actions">
      <MkButton
        aria-label="ファイルを選択"
        block
        data-testid="browse-files-button"
        :disabled="disabled"
        @click="openPicker"
      >
        ファイル選択
      </MkButton>
    </div>

    <div class="drop-zone__meta">
      <span>PNG / JPG / JPEG / PDF / DOCX / XLSX / PPTX ・ 10 ファイル ・ 合計 100 MB</span>
    </div>

    <input
      ref="fileInput"
      aria-label="取込対象ファイル"
      class="drop-zone__input"
      data-testid="file-input"
      multiple
      type="file"
      accept=".png,.jpg,.jpeg,.pdf,.docx,.xlsx,.pptx"
      @change="handleInputChange"
    />
  </section>
</template>

<style scoped>
.drop-zone {
  display: grid;
  gap: 1.2rem;
  padding: 1.35rem;
  border-radius: 24px;
}

.drop-zone--embedded {
  padding: 0;
  border-radius: 0;
}

.drop-zone--active {
  transform: translateY(-2px);
  border-color: rgba(47, 109, 138, 0.34);
}

.drop-zone:focus-visible {
  outline: 3px solid rgba(47, 109, 138, 0.32);
  outline-offset: 4px;
}

.drop-zone--disabled {
  opacity: 0.68;
}

.drop-zone__title {
  margin: 0;
  font-size: 1.3rem;
}

.drop-zone__status {
  margin: 0.35rem 0 0;
  color: var(--mk-muted);
  font-size: 0.95rem;
}

.drop-zone__actions {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.9rem;
}

.drop-zone__request {
  display: grid;
  gap: 0.35rem;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid var(--mk-border);
}

.drop-zone__request strong,
.drop-zone__request p {
  margin: 0;
}

.drop-zone__request--success {
  background: rgba(47, 123, 98, 0.07);
  color: var(--mk-success);
}

.drop-zone__request--warning {
  background: var(--mk-warning-surface);
  color: var(--mk-warning-deep);
}

.drop-zone__request--error {
  background: rgba(181, 74, 58, 0.07);
  color: var(--mk-danger);
}

.drop-zone__request--info {
  background: rgba(0, 123, 167, 0.06);
  color: var(--mk-accent-deep);
}

.drop-zone__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  color: var(--mk-muted);
  font-size: 0.9rem;
}

.drop-zone__input {
  display: none;
}

@media (max-width: 780px) {
  .drop-zone__status {
    font-size: 0.9rem;
  }
}

@media (max-width: 520px) {
  .drop-zone__actions {
    align-items: stretch;
  }
}
</style>
