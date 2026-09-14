<script setup lang="ts">
import MonacoCodeEditor from "@/components/editor/MonacoCodeEditor.vue";
import type { KvValueFormat } from "@/lib/kv/kvValueFormat";

withDefaults(defineProps<{ modelValue: string; format?: KvValueFormat; readOnly?: boolean }>(), { format: "text", readOnly: false });
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <MonacoCodeEditor :model-value="modelValue" :language="format" :read-only="readOnly" class="min-h-52 rounded-md border border-input bg-background" @update:model-value="emit('update:modelValue', $event)" />
</template>
