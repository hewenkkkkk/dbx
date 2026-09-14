<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { editor, IDisposable } from "monaco-editor";
import { useMonacoAppearance } from "@/composables/useMonacoAppearance";
import { applyMonacoTheme, createMonacoModel, loadMonaco, replaceMonacoModelValue, type Monaco } from "@/lib/editor/monaco/monaco";
import { monacoLanguageForFormat } from "@/lib/editor/monaco/monacoLanguage";
import { summarizeMonacoDiff, type MonacoDiffSummary } from "@/lib/editor/monaco/monacoDiff";

const props = withDefaults(defineProps<{ before: string; after: string; language?: string; inline?: boolean }>(), { language: "text", inline: false });
const emit = defineEmits<{ updated: [summary: MonacoDiffSummary | null] }>();
const host = ref<HTMLElement | null>(null);
const error = ref("");
const appearance = useMonacoAppearance();
let instance: editor.IStandaloneDiffEditor | null = null;
let original: editor.ITextModel | null = null;
let modified: editor.ITextModel | null = null;
let runtime: Monaco | null = null;
let listener: IDisposable | null = null;
let destroyed = false;

function dispose() {
  listener?.dispose();
  listener = null;
  instance?.setModel(null);
  instance?.dispose();
  instance = null;
  original?.dispose();
  modified?.dispose();
  original = null;
  modified = null;
}

onMounted(async () => {
  try {
    const monaco = await loadMonaco();
    if (destroyed || !host.value) return;
    runtime = monaco;
    original = createMonacoModel(monaco, props.before, monacoLanguageForFormat(props.language), "diff-original");
    modified = createMonacoModel(monaco, props.after, monacoLanguageForFormat(props.language), "diff-modified");
    instance = monaco.editor.createDiffEditor(host.value, {
      ...appearance.options.value,
      theme: applyMonacoTheme(monaco, appearance.theme.value),
      automaticLayout: true,
      readOnly: true,
      domReadOnly: true,
      originalEditable: false,
      renderSideBySide: !props.inline,
      ignoreTrimWhitespace: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      renderMarginRevertIcon: false,
      fixedOverflowWidgets: true,
    });
    listener = instance.onDidUpdateDiff(() => {
      const changes = instance?.getLineChanges();
      emit("updated", changes ? summarizeMonacoDiff(changes) : null);
    });
    instance.setModel({ original, modified });
    void instance.revealFirstDiff();
  } catch (cause) {
    dispose();
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

watch(
  () => [props.before, props.after],
  () => {
    if (!original || !modified) return;
    emit("updated", null);
    replaceMonacoModelValue(original, props.before, false);
    replaceMonacoModelValue(modified, props.after, false);
  },
);
watch(
  () => props.language,
  (language) => {
    if (!runtime) return;
    if (original) runtime.editor.setModelLanguage(original, monacoLanguageForFormat(language));
    if (modified) runtime.editor.setModelLanguage(modified, monacoLanguageForFormat(language));
  },
);
watch(
  () => props.inline,
  (inline) => instance?.updateOptions({ renderSideBySide: !inline }),
);
watch(appearance.options, (options) => instance?.updateOptions(options), { deep: true });
watch(appearance.theme, (theme) => {
  if (runtime) applyMonacoTheme(runtime, theme);
});
onBeforeUnmount(() => {
  destroyed = true;
  dispose();
});

defineExpose({ navigateChange: (direction: 1 | -1) => instance?.goToDiff(direction === 1 ? "next" : "previous") });
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden" data-monaco-diff-root>
    <div ref="host" class="absolute inset-0" />
    <div v-if="error" role="alert" class="absolute inset-0 overflow-auto bg-background p-3 text-sm text-destructive">{{ error }}</div>
  </div>
</template>
