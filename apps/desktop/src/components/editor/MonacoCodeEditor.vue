<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { editor } from "monaco-editor";
import { useMonacoEditor } from "@/composables/useMonacoEditor";
import { useMonacoAppearance } from "@/composables/useMonacoAppearance";
import { monacoLanguageForFormat } from "@/lib/editor/monaco/monacoLanguage";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    readOnly?: boolean;
    lineNumbers?: boolean;
    wordWrap?: boolean;
    options?: editor.IStandaloneEditorConstructionOptions;
  }>(),
  { language: "text", readOnly: false, lineNumbers: true, wordWrap: undefined, options: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: string]; ready: [instance: editor.IStandaloneCodeEditor] }>();
const host = ref<HTMLElement | null>(null);
const error = ref("");
const appearance = useMonacoAppearance();
const instance = useMonacoEditor({
  value: () => props.modelValue,
  language: () => monacoLanguageForFormat(props.language),
  theme: () => appearance.theme.value,
  options: () => ({
    ...appearance.options.value,
    readOnly: props.readOnly,
    domReadOnly: props.readOnly,
    lineNumbers: props.lineNumbers ? "on" : "off",
    ...(props.wordWrap === undefined ? {} : { wordWrap: props.wordWrap ? "on" : "off" }),
    ...props.options,
  }),
  onChange: (value) => emit("update:modelValue", value),
  onReady: (editor) => {
    emit("ready", editor);
  },
});

onMounted(async () => {
  if (!host.value) return;
  try {
    await instance.create(host.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

defineExpose({ ...instance, focus: () => instance.view.value?.focus() });
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden" data-monaco-editor-root>
    <div ref="host" class="absolute inset-0" />
    <div v-if="error" role="alert" class="absolute inset-0 overflow-auto bg-background p-3 text-sm text-destructive">{{ error }}</div>
  </div>
</template>
