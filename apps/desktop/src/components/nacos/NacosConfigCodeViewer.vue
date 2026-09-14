<script setup lang="ts">
import { computed } from "vue";
import MonacoCodeEditor from "@/components/editor/MonacoCodeEditor.vue";
import { resolveNacosConfigFormat } from "@/lib/nacos/nacosConfigLanguage";

const props = withDefaults(defineProps<{ content: string; format?: string; dataId?: string; lineNumbers?: boolean }>(), { format: "", dataId: "", lineNumbers: true });
const language = computed(() => resolveNacosConfigFormat(props.format, props.dataId));
</script>

<template>
  <MonacoCodeEditor :model-value="content" :language="language" :line-numbers="lineNumbers" read-only class="nacos-config-code-viewer rounded-md border bg-background" />
</template>
