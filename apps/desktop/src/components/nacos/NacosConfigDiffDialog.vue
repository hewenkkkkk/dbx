<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, ChevronUp, Loader2, X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MonacoDiffEditor from "@/components/editor/MonacoDiffEditor.vue";
import type { MonacoDiffSummary } from "@/lib/editor/monaco/monacoDiff";

const open = defineModel<boolean>("open", { default: false });

const props = withDefaults(
  defineProps<{
    before: string;
    after: string;
    title?: string;
    beforeLabel?: string;
    afterLabel?: string;
    confirmLabel?: string;
    confirmVariant?: "default" | "destructive";
    showConfirm?: boolean;
    loading?: boolean;
    format?: string;
  }>(),
  {
    title: "",
    beforeLabel: "",
    afterLabel: "",
    confirmLabel: "",
    confirmVariant: "default",
    showConfirm: true,
    loading: false,
    format: "text",
  },
);

const emit = defineEmits<{
  confirm: [];
}>();

const { t } = useI18n();
const inlineCompare = ref(false);
const diffStats = ref<MonacoDiffSummary | null>(null);
const diffEditor = ref<InstanceType<typeof MonacoDiffEditor> | null>(null);

const dialogOpen = computed({
  get: () => open.value,
  set: (value) => {
    if (props.loading && !value) return;
    open.value = value;
  },
});

function onConfirm() {
  if (!props.loading) emit("confirm");
}
</script>

<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent :show-close-button="false" class="nacos-config-diff-dialog flex h-[min(88vh,900px)] flex-col gap-0 overflow-hidden rounded-lg p-0 shadow-2xl">
      <DialogHeader class="shrink-0 border-b px-5 py-4">
        <div class="flex items-center justify-between gap-4">
          <DialogTitle class="text-lg font-semibold">{{ title || t("nacos.configDiffTitle") }}</DialogTitle>
          <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0" :disabled="loading" :aria-label="t('dangerDialog.cancel')" @click="open = false"><X class="h-4 w-4" /></Button>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label class="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input v-model="inlineCompare" type="checkbox" class="h-4 w-4 rounded border-border" />
            <span>{{ t("nacos.inlineCompare") }}</span>
          </label>
          <div class="flex items-center gap-3 text-xs text-muted-foreground">
            <span v-if="diffStats">{{ t("nacos.diffStats", { added: diffStats.added, removed: diffStats.removed, modified: diffStats.modified }) }}</span>
            <div v-if="diffStats?.changes" class="inline-flex items-center gap-1">
              <Button size="icon" variant="ghost" class="h-6 w-6" :title="t('nacos.previousDifference')" :aria-label="t('nacos.previousDifference')" @click="diffEditor?.navigateChange(-1)"><ChevronUp class="h-3.5 w-3.5" /></Button>
              <span>{{ diffStats.changes }}</span>
              <Button size="icon" variant="ghost" class="h-6 w-6" :title="t('nacos.nextDifference')" :aria-label="t('nacos.nextDifference')" @click="diffEditor?.navigateChange(1)"><ChevronDown class="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-2 bg-background px-5 py-4">
        <div class="grid shrink-0 grid-cols-2 gap-4 text-sm font-medium text-foreground">
          <span>{{ beforeLabel || t("nacos.currentVersionContent") }}</span>
          <span>{{ afterLabel || t("nacos.publishVersionContent") }}</span>
        </div>
        <MonacoDiffEditor ref="diffEditor" :before="before" :after="after" :language="format" :inline="inlineCompare" class="min-h-0 flex-1 rounded-md border" @updated="diffStats = $event" />
      </div>

      <DialogFooter class="shrink-0 gap-3 border-t bg-muted/20 px-5 pb-6 pt-4">
        <Button v-if="showConfirm" :variant="confirmVariant" class="min-w-24 gap-1.5 px-5" :disabled="loading" @click="onConfirm">
          <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
          {{ confirmLabel || t("nacos.publish") }}
        </Button>
        <Button variant="outline" class="min-w-24 px-5" :disabled="loading" @click="open = false">{{ t("dangerDialog.cancel") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style>
.nacos-config-diff-dialog {
  width: min(96vw, 1440px) !important;
  max-width: min(96vw, 1440px) !important;
}

@media (max-width: 1023px) {
  .nacos-config-diff-dialog {
    width: min(96vw, 760px) !important;
    max-width: min(96vw, 760px) !important;
  }
}
</style>
