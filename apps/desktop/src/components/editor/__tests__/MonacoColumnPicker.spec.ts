// @vitest-environment happy-dom

import { createApp, h, nextTick, ref, type App } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import MonacoColumnPicker from "../MonacoColumnPicker.vue";
import { createMonacoColumnSelection } from "@/lib/editor/monaco/monacoColumnSelection";
import type { MonacoCompletionCandidate } from "@/lib/editor/monaco/monacoSqlCompletion";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const apps: App[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

async function mountPicker(selectFirst = true, count = 3, prefix = "") {
  const candidates: MonacoCompletionCandidate[] = Array.from({ length: count }, (_, index) => ({ label: `field_${index}`, apply: `field_${index}`, type: "column", batchSelectionMode: "select" }));
  const selection = ref(createMonacoColumnSelection(candidates, `SELECT ${prefix} FROM users`, 7, 7 + prefix.length)!);
  const component = ref<InstanceType<typeof MonacoColumnPicker>>();
  const confirm = vi.fn();
  const accept = vi.fn();
  const close = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp({ render: () => h(MonacoColumnPicker, { ref: component, selection: selection.value, candidates, selectFirst, onConfirm: confirm, onAccept: accept, onClose: close }) });
  apps.push(app);
  app.mount(host);
  await nextTick();
  const key = async (value: string, init: KeyboardEventInit = {}) => {
    const handled = component.value!.onKeyDown(new KeyboardEvent("keydown", { key: value, ...init }));
    await nextTick();
    return handled;
  };
  return { host, key, confirm, accept, close, selection, candidates };
}

describe("cursor-adjacent Monaco column completion", () => {
  it.each(["Enter", "Tab"])("inserts checked fields with one %s", async (acceptKey) => {
    const picker = await mountPicker();
    await picker.key(" ");
    await picker.key("ArrowDown");
    await picker.key(" ");
    expect(await picker.key(acceptKey)).toBe(true);
    expect(picker.confirm).toHaveBeenCalledExactlyOnceWith(["field_0", "field_1"]);
    expect(picker.accept).not.toHaveBeenCalled();
    expect(picker.host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps unselected-on-open behavior while Tab can choose the first item", async () => {
    const picker = await mountPicker(false);
    expect(picker.host.querySelector('[aria-selected="true"]')).toBeNull();
    expect(await picker.key(" ")).toBe(false);
    expect(await picker.key("Enter")).toBe(false);
    expect(picker.accept).not.toHaveBeenCalled();
    expect(await picker.key("Tab")).toBe(true);
    expect(picker.accept).toHaveBeenCalledExactlyOnceWith(picker.candidates[0]);
  });

  it("does not consume IME, execution modifiers or backward snippet navigation", async () => {
    const picker = await mountPicker();
    expect(await picker.key("Enter", { isComposing: true })).toBe(false);
    expect(await picker.key("Enter", { keyCode: 229 })).toBe(false);
    expect(await picker.key("Enter", { ctrlKey: true })).toBe(false);
    expect(await picker.key("Enter", { metaKey: true })).toBe(false);
    expect(await picker.key("Tab", { shiftKey: true })).toBe(false);
    expect(picker.accept).not.toHaveBeenCalled();
    expect(picker.confirm).not.toHaveBeenCalled();
  });

  it("bounds rendered rows and navigates beyond the initial window", async () => {
    const picker = await mountPicker(true, 1000);
    expect(picker.host.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(16);
    await picker.key("PageDown");
    await picker.key("PageDown");
    await picker.key(" ");
    await picker.key("Enter");
    expect(picker.confirm).toHaveBeenCalledExactlyOnceWith(["field_18"]);
    expect(picker.host.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(16);
  });

  it("filters the original candidates and resets selections for a new document", async () => {
    const picker = await mountPicker(true, 3, "field_1");
    expect(picker.host.querySelectorAll('[role="option"]')).toHaveLength(1);
    await picker.key(" ");
    picker.selection.value = { ...picker.selection.value, document: "SELECT  FROM users", to: 7 };
    await nextTick();
    expect(picker.host.querySelector("input:checked")).toBeNull();
    await picker.key("Escape");
    expect(picker.close).toHaveBeenCalledOnce();
  });
});
