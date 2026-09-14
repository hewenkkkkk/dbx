<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { completionMatchRanges } from "@/lib/common/completionMatch";
import type { MonacoColumnSelection } from "@/lib/editor/monaco/monacoColumnSelection";
import type { MonacoCompletionCandidate } from "@/lib/editor/monaco/monacoSqlCompletion";

const props = defineProps<{ selection: MonacoColumnSelection; candidates: MonacoCompletionCandidate[]; selectFirst: boolean }>();
const emit = defineEmits<{ close: []; confirm: [keys: string[]]; accept: [candidate: MonacoCompletionCandidate]; layout: [] }>();
const { t } = useI18n();
const selected = ref(new Set<string>());
const focused = ref(-1);
const list = ref<HTMLElement>();
const scrollTop = ref(0);
const rowHeight = 28;
const viewportHeight = 252;
const choices = computed(() => new Set(props.selection.choices.map((choice) => choice.key)));
const candidates = computed(() => {
  const prefix = props.selection.document.slice(props.selection.from, props.selection.to);
  return props.candidates.filter((candidate) => !prefix || completionMatchRanges(candidate.filterText ?? candidate.label, prefix).length > 0);
});
const start = computed(() => Math.max(0, Math.floor(scrollTop.value / rowHeight) - 3));
const visible = computed(() => candidates.value.slice(start.value, start.value + 16));
let drag: { index: number; checked: boolean; clientX: number; clientY: number } | null = null;
let dragFrame = 0;

watch(
  () => props.selection,
  () => {
    finishDrag();
    selected.value = new Set();
    focused.value = props.selectFirst ? 0 : -1;
    scrollTop.value = 0;
    if (list.value) list.value.scrollTop = 0;
    void nextTick(() => emit("layout"));
  },
  { immediate: true },
);

function selectable(candidate: MonacoCompletionCandidate) {
  return candidate.type === "column" && candidate.batchSelectionMode === props.selection.mode && choices.value.has(candidate.apply ?? "");
}

function setChecked(index: number, checked: boolean) {
  const candidate = candidates.value[index];
  if (!candidate || !selectable(candidate)) return;
  if (checked) selected.value.add(candidate.apply!);
  else selected.value.delete(candidate.apply!);
}

function focus(index: number) {
  focused.value = Math.max(0, Math.min(candidates.value.length - 1, index));
  const element = list.value;
  if (!element) return;
  const top = focused.value * rowHeight;
  if (top < element.scrollTop) element.scrollTop = top;
  else if (top + rowHeight > element.scrollTop + viewportHeight) element.scrollTop = top + rowHeight - viewportHeight;
  scrollTop.value = element.scrollTop;
}

function accept(index: number) {
  const candidate = candidates.value[index];
  if (candidate) emit("accept", candidate);
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== "Tab")) return false;
  switch (event.key) {
    case "Escape":
      emit("close");
      return true;
    case "ArrowDown":
      focus(focused.value + 1);
      return true;
    case "ArrowUp":
      focus(focused.value < 0 ? candidates.value.length - 1 : focused.value - 1);
      return true;
    case "PageDown":
      focus(focused.value + 9);
      return true;
    case "PageUp":
      focus(focused.value - 9);
      return true;
    case " ": {
      const candidate = candidates.value[focused.value];
      if (!candidate || !selectable(candidate)) return false;
      setChecked(focused.value, !selected.value.has(candidate.apply!));
      return true;
    }
    case "Enter":
    case "Tab":
      if (event.shiftKey) return false;
      if (selected.value.size) emit("confirm", [...selected.value]);
      else if (focused.value >= 0 || event.key === "Tab") accept(Math.max(0, focused.value));
      else {
        emit("close");
        return false;
      }
      return true;
    default:
      return false;
  }
}

function updateDrag() {
  const element = list.value;
  if (!drag || !element) return;
  const bounds = element.getBoundingClientRect();
  if (drag.clientX < bounds.left || drag.clientX > bounds.right) return;
  const offset = Math.max(0, Math.min(bounds.height - 1, drag.clientY - bounds.top));
  const index = Math.max(0, Math.min(candidates.value.length - 1, Math.floor((element.scrollTop + offset) / rowHeight)));
  for (let cursor = Math.min(drag.index, index); cursor <= Math.max(drag.index, index); cursor++) setChecked(cursor, drag.checked);
  drag.index = index;
  focused.value = index;
}

function autoScroll() {
  dragFrame = 0;
  if (!drag || !list.value) return;
  const bounds = list.value.getBoundingClientRect();
  if (drag.clientY < bounds.top + 20) list.value.scrollTop -= 10;
  else if (drag.clientY > bounds.bottom - 20) list.value.scrollTop += 10;
  scrollTop.value = list.value.scrollTop;
  updateDrag();
  dragFrame = requestAnimationFrame(autoScroll);
}

function moveDrag(event: PointerEvent) {
  if (!drag) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  updateDrag();
}

function finishDrag() {
  drag = null;
  cancelAnimationFrame(dragFrame);
  window.removeEventListener("pointermove", moveDrag, true);
  window.removeEventListener("pointerup", finishDrag, true);
  window.removeEventListener("pointercancel", finishDrag, true);
  window.removeEventListener("blur", finishDrag);
}

function startDrag(event: PointerEvent, index: number) {
  if (event.button !== 0) return;
  finishDrag();
  const candidate = candidates.value[index]!;
  drag = { index, checked: !selected.value.has(candidate.apply!), clientX: event.clientX, clientY: event.clientY };
  setChecked(index, drag.checked);
  focused.value = index;
  window.addEventListener("pointermove", moveDrag, true);
  window.addEventListener("pointerup", finishDrag, true);
  window.addEventListener("pointercancel", finishDrag, true);
  window.addEventListener("blur", finishDrag);
  dragFrame = requestAnimationFrame(autoScroll);
}

onBeforeUnmount(finishDrag);
defineExpose({ onKeyDown });
</script>

<template>
  <div class="dbx-column-completion" data-monaco-column-picker @pointerdown.prevent @mousedown.prevent>
    <div ref="list" role="listbox" :aria-label="t('editor.completion.chooseColumns')" class="dbx-column-completion-list" :style="{ maxHeight: `${viewportHeight}px` }" @scroll="scrollTop = ($event.target as HTMLElement).scrollTop">
      <div :style="{ height: `${start * rowHeight}px` }" />
      <div
        v-for="(candidate, index) in visible"
        :key="start + index"
        role="option"
        :aria-selected="focused === start + index"
        :data-column-index="start + index"
        class="dbx-column-completion-row"
        :class="{ active: focused === start + index }"
        :style="{ height: `${rowHeight}px` }"
        @click="accept(start + index)"
      >
        <input v-if="selectable(candidate)" type="checkbox" tabindex="-1" :aria-label="candidate.label" :checked="selected.has(candidate.apply!)" @pointerdown.stop.prevent="startDrag($event, start + index)" @mousedown.stop.prevent @click.stop.prevent />
        <span v-else class="dbx-column-completion-kind">{{ candidate.type === "function" ? "ƒ" : "›" }}</span>
        <span class="dbx-column-completion-label" :title="candidate.info ?? candidate.label">{{ candidate.label }}</span>
        <span v-if="candidate.detail" class="dbx-column-completion-detail" :title="candidate.detail">{{ candidate.detail }}</span>
      </div>
      <div :style="{ height: `${Math.max(0, candidates.length - start - visible.length) * rowHeight}px` }" />
    </div>
    <button type="button" tabindex="-1" class="dbx-column-completion-action" :disabled="selected.size === 0" @click="emit('confirm', [...selected])">{{ t("editor.completion.insertSelectedColumns", { count: selected.size }) }} <span>Enter / Tab</span></button>
  </div>
</template>

<style scoped>
.dbx-column-completion {
  width: 460px;
  max-width: calc(100vw - 24px);
  color: var(--vscode-editorSuggestWidget-foreground);
  background: var(--vscode-editorSuggestWidget-background);
  border: 1px solid var(--vscode-editorSuggestWidget-border);
  border-radius: 4px;
  box-shadow: 0 4px 14px #0003;
  font-size: 12px;
  user-select: none;
}
.dbx-column-completion-list {
  overflow-y: auto;
  overscroll-behavior: contain;
}
.dbx-column-completion-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
}
.dbx-column-completion-row:hover {
  background: var(--vscode-list-hoverBackground);
}
.dbx-column-completion-row.active {
  color: var(--vscode-editorSuggestWidget-selectedForeground);
  background: var(--vscode-editorSuggestWidget-selectedBackground);
}
.dbx-column-completion-row input {
  flex: 0 0 13px;
  width: 13px;
  height: 13px;
  accent-color: var(--vscode-focusBorder);
}
.dbx-column-completion-kind {
  flex: 0 0 13px;
  text-align: center;
}
.dbx-column-completion-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
}
.dbx-column-completion-detail {
  max-width: 48%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}
.dbx-column-completion-action {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 6px 8px;
  border-top: 1px solid var(--vscode-editorSuggestWidget-border);
  cursor: pointer;
}
.dbx-column-completion-action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
