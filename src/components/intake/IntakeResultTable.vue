<script setup lang="ts">
import type { IntakeFileResult, IntakeResultDisplaySummary } from "@/types/intake";

const props = withDefaults(
  defineProps<{
    isRefreshing: boolean;
    results: IntakeFileResult[];
    summary: IntakeResultDisplaySummary;
    surface?: boolean;
    showOverview?: boolean;
  }>(),
  {
    surface: true,
    showOverview: true,
  },
);

function statusColor(status: IntakeFileResult["status"]): "success" | "error" | "warning" {
  if (status === "ACCEPTED") return "success";
  if (status === "REJECTED") return "error";
  return "warning";
}

function statusLabel(status: IntakeFileResult["status"]): string {
  if (status === "ACCEPTED") return "受付済み";
  if (status === "REJECTED") return "受付できず";
  return "画像なし";
}

function rowClass(status: IntakeFileResult["status"]): string {
  if (status === "ACCEPTED") return "result-table__row--accepted";
  if (status === "REJECTED") return "result-table__row--rejected";
  return "result-table__row--no-image";
}
</script>

<template>
  <section class="result-table" :class="{ 'mk-surface': surface, 'result-table--embedded': !surface }">
    <header class="result-table__header">
      <div>
        <h2 class="mk-section-title">ファイルごとの結果</h2>
      </div>
      <span class="mk-muted">{{ props.results.length }} 件</span>
    </header>

    <section
      v-if="props.showOverview && (props.results.length > 0 || props.isRefreshing)"
      class="result-table__overview"
      :class="`result-table__overview--${props.summary.tone}`"
    >
      <div>
        <p class="result-table__overview-label">{{ props.summary.phaseLabel }}</p>
        <strong>{{ props.summary.title }}</strong>
      </div>
      <p>{{ props.summary.message }}</p>
      <div class="result-table__digest">
        <span class="result-table__digest-chip result-table__digest-chip--success">
          画像あり受付 {{ props.summary.acceptedCount }} 件
        </span>
        <span class="result-table__digest-chip result-table__digest-chip--warning">
          画像なし受付 {{ props.summary.noImageCount }} 件
        </span>
        <span class="result-table__digest-chip result-table__digest-chip--error">
          受付失敗 {{ props.summary.rejectedCount }} 件
        </span>
      </div>
      <p class="result-table__hint">{{ props.summary.reviewHint }}</p>
      <p v-if="props.isRefreshing" class="result-table__refreshing">最後の結果を表示したまま最新状態へ更新しています。</p>
    </section>

    <div v-if="props.results.length === 0" class="mk-empty-state">
      まだありません。
    </div>

    <v-table v-else class="result-table__table">
      <thead>
        <tr>
          <th>ファイル</th>
          <th>結果</th>
          <th>画像数</th>
          <th>補足</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in props.results"
          :key="item.fileId"
          :class="rowClass(item.status)"
          data-testid="result-row"
        >
          <td>{{ item.fileName }}</td>
          <td>
            <v-chip :color="statusColor(item.status)" size="small" variant="tonal">
              {{ statusLabel(item.status) }}
            </v-chip>
          </td>
          <td>{{ item.imageCount }}</td>
          <td>{{ item.message }}</td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.result-table {
  display: grid;
  gap: 1rem;
  padding: 1.2rem;
  border-radius: 22px;
}

.result-table--embedded {
  padding: 0;
  border-radius: 0;
}

.result-table__header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1rem;
}

.result-table__overview {
  display: grid;
  gap: 0.55rem;
  padding: 1rem 1.05rem;
  border-radius: 18px;
  border: 1px solid rgba(55, 88, 109, 0.1);
}

.result-table__overview strong,
.result-table__overview p {
  margin: 0;
}

.result-table__overview-label {
  margin: 0 0 0.25rem;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.result-table__overview--success {
  background: rgba(47, 123, 98, 0.09);
  color: var(--mk-success);
}

.result-table__overview--warning {
  background: var(--mk-warning-surface-strong);
  color: var(--mk-warning-deep);
}

.result-table__overview--error {
  background: rgba(181, 74, 58, 0.09);
  color: var(--mk-danger);
}

.result-table__overview--info {
  background: rgba(53, 93, 146, 0.08);
  color: #355d92;
}

.result-table__digest {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.result-table__digest-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  border: 1px solid rgba(55, 88, 109, 0.08);
  font-size: 0.84rem;
  font-weight: 700;
}

.result-table__digest-chip--success {
  background: rgba(47, 123, 98, 0.08);
}

.result-table__digest-chip--warning {
  background: var(--mk-warning-surface);
}

.result-table__digest-chip--error {
  background: rgba(181, 74, 58, 0.08);
}

.result-table__hint,
.result-table__refreshing {
  color: var(--mk-muted);
}

.result-table__table :deep(table) {
  border-collapse: separate;
  border-spacing: 0 0.5rem;
}

.result-table__table :deep(th) {
  color: var(--mk-muted);
  font-weight: 700;
}

.result-table__table :deep(td) {
  padding-top: 0.85rem;
  padding-bottom: 0.85rem;
  background: rgba(247, 250, 252, 0.82);
}

.result-table__table :deep(tbody tr.result-table__row--accepted td) {
  background: linear-gradient(135deg, rgba(47, 123, 98, 0.08), rgba(247, 250, 252, 0.92));
}

.result-table__table :deep(tbody tr.result-table__row--rejected td) {
  background: linear-gradient(135deg, rgba(181, 74, 58, 0.1), rgba(247, 250, 252, 0.92));
}

.result-table__table :deep(tbody tr.result-table__row--no-image td) {
  background: linear-gradient(135deg, var(--mk-warning-surface-strong), rgba(247, 250, 252, 0.92));
}

.result-table__table :deep(tbody tr td:first-child) {
  border-top-left-radius: 16px;
  border-bottom-left-radius: 16px;
}

.result-table__table :deep(tbody tr td:last-child) {
  border-top-right-radius: 16px;
  border-bottom-right-radius: 16px;
}
</style>
