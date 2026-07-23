<script setup lang="ts">
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    tone?: "primary" | "secondary" | "danger" | "ghost";
    block?: boolean;
    disabled?: boolean;
    loading?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  {
    tone: "primary",
    block: false,
    disabled: false,
    loading: false,
    type: "button",
  },
);

const color = computed(() => {
  if (props.tone === "danger") return "error";
  if (props.tone === "secondary") return "secondary";
  if (props.tone === "ghost") return "secondary";
  return "primary";
});

const variant = computed(() => (props.tone === "ghost" ? "text" : props.tone === "secondary" ? "outlined" : "flat"));
</script>

<template>
  <v-btn
    v-bind="$attrs"
    :block="block"
    :color="color"
    :disabled="disabled"
    :loading="loading"
    :type="type"
    :variant="variant"
    class="mk-button"
    :class="`mk-button--${tone}`"
  >
    <slot />
  </v-btn>
</template>

<style scoped>
.mk-button {
  min-height: 44px;
  border-radius: 14px;
  text-transform: none;
  font-weight: 700;
  letter-spacing: 0.02em;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
  position: relative;
}

/* Vuetify のデフォルトリップルエフェクトを無効化 */
:deep(.v-ripple__container) {
  display: none;
}

.mk-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.mk-button:active:not(:disabled) {
  transform: translateY(0);
}

.mk-button--primary {
  box-shadow: 0 8px 16px rgba(0, 123, 167, 0.15);
}

.mk-button--primary:hover:not(:disabled) {
  box-shadow: 0 12px 24px rgba(0, 123, 167, 0.25);
}

.mk-button--primary:active:not(:disabled) {
  box-shadow: 0 2px 8px rgba(0, 123, 167, 0.15);
}

.mk-button--secondary {
  border-color: rgba(82, 96, 109, 0.2);
}

.mk-button--secondary:hover:not(:disabled) {
  border-color: rgba(82, 96, 109, 0.4);
  background-color: rgba(82, 96, 109, 0.05);
}

.mk-button--ghost {
  color: var(--mk-muted);
}

.mk-button--ghost:hover:not(:disabled) {
  color: var(--mk-text);
  background-color: rgba(0, 0, 0, 0.04);
}
</style>
