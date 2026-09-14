import type { editor } from "monaco-editor";

export type Monaco = typeof import("monaco-editor/editor/editor.api");

let runtimePromise: Promise<Monaco> | undefined;
let lastTheme: string | undefined;
let nextModelId = 0;

export function loadMonaco(): Promise<Monaco> {
  runtimePromise ??= import("./monacoRuntime")
    .then(({ monaco }) => monaco)
    .catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  return runtimePromise;
}

export function applyMonacoTheme(monaco: Monaco, theme: editor.IStandaloneThemeData): string {
  const serialized = JSON.stringify(theme);
  if (lastTheme !== serialized) {
    monaco.editor.defineTheme("dbx-editor", theme);
    monaco.editor.setTheme("dbx-editor");
    lastTheme = serialized;
  }
  return "dbx-editor";
}

export function createMonacoModel(monaco: Monaco, value: string, language: string, scope = "editor"): editor.ITextModel {
  const uri = monaco.Uri.from({ scheme: "dbx", path: `/${scope}/${++nextModelId}` });
  return monaco.editor.createModel(value, language, uri);
}

export function replaceMonacoModelValue(model: editor.ITextModel, value: string, undoable = true): boolean {
  if (model.isDisposed() || model.getValue() === value) return false;
  if (undoable) {
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: model.getFullModelRange(), text: value }], () => null);
    model.pushStackElement();
  } else {
    model.setValue(value);
  }
  return true;
}

export function monacoRangeFromOffsets(model: editor.ITextModel, from: number, to: number) {
  const start = model.getPositionAt(from);
  const end = model.getPositionAt(to);
  return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
}

export function runMonacoAction(instance: editor.IStandaloneCodeEditor | null, id: string): boolean {
  const action = instance?.getAction(id);
  if (!action?.isSupported()) return false;
  void action.run();
  return true;
}
