import { getCurrentScope, onScopeDispose, shallowRef, watch } from "vue";
import type { editor, IDisposable } from "monaco-editor";
import { applyMonacoTheme, createMonacoModel, loadMonaco, monacoRangeFromOffsets, replaceMonacoModelValue, runMonacoAction, type Monaco } from "@/lib/editor/monaco/monaco";

export interface UseMonacoEditorOptions {
  value?: () => string;
  language?: () => string;
  theme?: () => editor.IStandaloneThemeData;
  options?: () => editor.IStandaloneEditorConstructionOptions;
  onChange?: (value: string) => void;
  onReady?: (instance: editor.IStandaloneCodeEditor, monaco: Monaco) => IDisposable | void;
}

export function useMonacoEditor(options: UseMonacoEditorOptions = {}) {
  const view = shallowRef<editor.IStandaloneCodeEditor | null>(null);
  let runtime: Monaco | null = null;
  let model: editor.ITextModel | null = null;
  let listeners: IDisposable[] = [];
  let generation = 0;
  let destroyed = false;
  let pendingValue = "";
  let suppressChange = 0;

  function disposeCurrent() {
    for (const listener of listeners) listener.dispose();
    listeners = [];
    view.value?.setModel(null);
    view.value?.dispose();
    view.value = null;
    model?.dispose();
    model = null;
  }

  async function create(parent: HTMLElement, value = options.value?.() ?? pendingValue) {
    if (destroyed) return;
    const currentGeneration = ++generation;
    pendingValue = value;
    disposeCurrent();
    const monaco = await loadMonaco();
    if (destroyed || currentGeneration !== generation) return;
    runtime = monaco;
    model = createMonacoModel(monaco, options.value?.() ?? pendingValue, options.language?.() ?? "plaintext");
    try {
      const theme = options.theme?.();
      const instance = monaco.editor.create(parent, {
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true,
        renderLineHighlight: "line",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        padding: { top: 6, bottom: 6 },
        ...options.options?.(),
        ...(theme ? { theme: applyMonacoTheme(monaco, theme) } : {}),
        model,
      });
      view.value = instance;
      listeners.push(
        instance.onDidChangeModelContent(() => {
          if (!suppressChange) options.onChange?.(instance.getValue());
        }),
      );
      const readyListener = options.onReady?.(instance, monaco);
      if (readyListener) {
        if (destroyed || view.value !== instance) readyListener.dispose();
        else listeners.push(readyListener);
      }
    } catch (error) {
      disposeCurrent();
      throw error;
    }
  }

  function setValue(value: string, undoable = true) {
    pendingValue = value;
    if (!model) return;
    suppressChange++;
    try {
      replaceMonacoModelValue(model, value, undoable);
    } finally {
      suppressChange--;
    }
  }

  function selectRange(from: number, to: number, selectionOptions?: { focus?: boolean }): boolean {
    const instance = view.value;
    if (!instance || !model) return false;
    const anchor = model.getPositionAt(from);
    const head = model.getPositionAt(to);
    instance.setSelection({ selectionStartLineNumber: anchor.lineNumber, selectionStartColumn: anchor.column, positionLineNumber: head.lineNumber, positionColumn: head.column });
    instance.revealRangeInCenterIfOutsideViewport(monacoRangeFromOffsets(model, Math.min(from, to), Math.max(from, to)));
    if (selectionOptions?.focus !== false) instance.focus();
    return true;
  }

  const stops = [
    watch(
      () => options.value?.(),
      (value) => {
        if (value !== undefined) setValue(value);
      },
    ),
    watch(
      () => options.language?.(),
      (language) => {
        if (model && runtime && language) runtime.editor.setModelLanguage(model, language);
      },
    ),
    watch(
      () => options.options?.(),
      (settings) => {
        if (settings) view.value?.updateOptions(settings);
      },
      { deep: true },
    ),
    watch(
      () => options.theme?.(),
      (theme) => {
        if (runtime && theme) applyMonacoTheme(runtime, theme);
      },
      { deep: true },
    ),
  ];

  function destroy() {
    destroyed = true;
    generation++;
    for (const stop of stops) stop();
    disposeCurrent();
  }

  if (getCurrentScope()) onScopeDispose(destroy);

  return {
    view,
    create,
    destroy,
    setValue,
    getValue: () => model?.getValue() ?? pendingValue,
    selectRange,
    openSearch: () => runMonacoAction(view.value, "actions.find"),
    openReplace: () => runMonacoAction(view.value, "editor.action.startFindReplaceAction"),
  };
}
