import type { editor } from "monaco-editor";
import type { VimAdapterInstance } from "monaco-vim";

type VimRuntime = typeof import("monaco-vim");
let runtimePromise: Promise<VimRuntime> | undefined;
const configuredRuntimes = new WeakSet<object>();
const saveCallbacks = new WeakMap<VimAdapterInstance, () => void>();

export function loadMonacoVim(): Promise<VimRuntime> {
  runtimePromise ??= import("monaco-vim").catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

function configureSave(runtime: VimRuntime) {
  if (configuredRuntimes.has(runtime.VimMode)) return;
  const commands = runtime.VimMode as unknown as { Vim: { defineEx: (name: string, shorthand: string, callback: (adapter: VimAdapterInstance) => void) => void } };
  commands.Vim.defineEx("write", "w", (adapter) => saveCallbacks.get(adapter)?.());
  configuredRuntimes.add(runtime.VimMode);
}

export function createMonacoVimController(instance: editor.IStandaloneCodeEditor, status: HTMLElement, onSave: () => void) {
  let adapter: VimAdapterInstance | null = null;
  let enabled = false;
  let destroyed = false;
  let generation = 0;
  const originalOptions = instance.getRawOptions();
  const restoreCursor = { cursorStyle: originalOptions.cursorStyle ?? ("line" as const), cursorBlinking: originalOptions.cursorBlinking ?? ("blink" as const), cursorWidth: originalOptions.cursorWidth ?? 0 };

  function detach() {
    if (adapter) {
      saveCallbacks.delete(adapter);
      adapter.dispose();
      adapter = null;
      instance.updateOptions(restoreCursor);
    }
    status.replaceChildren();
    status.hidden = true;
  }

  async function setEnabled(next: boolean) {
    enabled = next;
    const request = ++generation;
    if (destroyed || !next) {
      detach();
      return;
    }
    if (adapter) return;
    const runtime = await loadMonacoVim();
    if (destroyed || !enabled || request !== generation) return;
    configureSave(runtime);
    status.hidden = false;
    adapter = runtime.initVimMode(instance, status);
    saveCallbacks.set(adapter, onSave);
  }

  function reset() {
    detach();
    return setEnabled(enabled);
  }

  function dispose() {
    destroyed = true;
    generation++;
    enabled = false;
    detach();
  }

  return { setEnabled, reset, dispose, isActive: () => adapter !== null };
}
