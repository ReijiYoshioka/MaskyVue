<script setup lang="ts">
// index-03.html の flowNav() に相当。処理結果の「タスクを選ぶ→ファイルを選ぶ→画像を確認」の
// 3段階ドリルダウンを、現在地が一目でわかる帯として表示する。
export interface FlowStep {
  label: string
  title: string
  value: string
  /** 完了済みステップのみ戻れる(クリック可能)。現在地・未到達ステップはクリックできない。 */
  clickable: boolean
}

const props = defineProps<{
  steps: FlowStep[]
  /** 1始まりの現在ステップ番号。 */
  current: number
}>()

const emit = defineEmits<{ 'step-click': [index: number] }>()

function stepState(index: number): 'done' | 'current' | '' {
  const n = index + 1
  if (n === props.current) return 'current'
  if (n < props.current) return 'done'
  return ''
}
</script>

<template>
  <nav class="flow-nav" aria-label="表示中の階層">
    <component
      :is="step.clickable ? 'button' : 'div'"
      v-for="(step, index) in steps"
      :key="step.label"
      type="button"
      class="flow-step"
      :class="stepState(index)"
      @click="step.clickable && emit('step-click', index)"
    >
      <span class="step-num">
        <v-icon v-if="stepState(index) === 'done'" icon="mdi-check" size="16" />
        <template v-else>{{ index + 1 }}</template>
      </span>
      <span class="flow-label">
        <small>{{ step.label }}　{{ step.title }}</small>
        <strong :title="step.value">{{ step.value }}</strong>
      </span>
    </component>
  </nav>
</template>

<style scoped>
.flow-nav {
  display: flex;
  margin-bottom: 22px;
  background: #fff;
  border: 1px solid var(--mk-border);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05);
  overflow: hidden;
}

.flow-step {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px 14px 26px;
  position: relative;
  color: var(--mk-muted);
  background: #fff;
  border: 0;
  cursor: default;
  text-align: left;
  font: inherit;
}

.flow-step:first-child {
  padding-left: 18px;
}

.flow-step + .flow-step {
  border-left: 1px solid var(--mk-border);
}

.flow-step + .flow-step::before {
  content: "";
  position: absolute;
  left: -1px;
  top: 50%;
  width: 14px;
  height: 14px;
  transform: translate(-50%, -50%) rotate(45deg);
  background: inherit;
  border-top: 1px solid var(--mk-border);
  border-right: 1px solid var(--mk-border);
  border-radius: 0 3px 0 0;
}

button.flow-step {
  cursor: pointer;
}

.step-num {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef1f6;
  color: var(--mk-muted);
  font-weight: 800;
  font-size: 14px;
}

.flow-label {
  min-width: 0;
}

.flow-label small {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .06em;
}

.flow-label strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.flow-step.done {
  color: var(--mk-text);
}

.flow-step.done .step-num {
  background: #e5f5ee;
  color: var(--mk-success);
}

button.flow-step.done:hover {
  background: #f6f9ff;
}

.flow-step.current {
  background: #e9efff;
  color: var(--mk-primary);
}

.flow-step.current .step-num {
  background: var(--mk-primary);
  color: #fff;
}

.flow-step.current strong {
  color: var(--mk-primary);
}
</style>
