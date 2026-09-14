import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTreeAvailable, language as sqlLanguage } from "@codemirror/language";
import type { editor, IDisposable } from "monaco-editor";

interface SqlContextEntry {
  state: EditorState;
  timer?: ReturnType<typeof setTimeout>;
  disposed: boolean;
}

const contexts = new WeakMap<editor.ITextModel, SqlContextEntry>();

export function attachMonacoSqlContext(model: editor.ITextModel, language: Extension): IDisposable {
  const entry: SqlContextEntry = {
    state: EditorState.create({ doc: model.getValue(), extensions: [language, EditorState.lineSeparator.of("\n"), EditorState.allowMultipleSelections.of(true)] }),
    disposed: false,
  };
  contexts.set(model, entry);
  const parse = () => {
    entry.timer = undefined;
    if (entry.disposed) return;
    if (!entry.state.facet(sqlLanguage)) return;
    ensureSyntaxTree(entry.state, entry.state.doc.length, 8);
    entry.state = entry.state.update({}).state;
    if (!syntaxTreeAvailable(entry.state, entry.state.doc.length)) entry.timer = setTimeout(parse, 50);
  };
  const scheduleParse = () => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(parse, 50);
  };
  const listener = model.onDidChangeContent((event) => {
    const changes = event.isEolChange || event.isFlush ? { from: 0, to: entry.state.doc.length, insert: model.getValue() } : event.changes.map((change) => ({ from: change.rangeOffset, to: change.rangeOffset + change.rangeLength, insert: change.text }));
    entry.state = entry.state.update({ changes }).state;
    scheduleParse();
  });
  scheduleParse();
  const dispose = () => {
    if (entry.disposed) return;
    entry.disposed = true;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    listener.dispose();
    disposalListener.dispose();
    if (contexts.get(model) === entry) contexts.delete(model);
  };
  const disposalListener = model.onWillDispose(dispose);
  return { dispose };
}

export function monacoSqlContextState(instance: editor.IStandaloneCodeEditor): EditorState {
  const model = instance.getModel();
  const entry = model ? contexts.get(model) : undefined;
  if (!model || !entry) throw new Error("SQL editor model has no parser context");
  const selections = instance.getSelections() ?? [];
  const ranges = selections.map((selection) => EditorSelection.range(model.getOffsetAt(selection.getSelectionStart()), model.getOffsetAt(selection.getPosition())));
  const selection = ranges.length ? EditorSelection.create(ranges) : EditorSelection.single(0);
  if (!entry.state.selection.eq(selection)) entry.state = entry.state.update({ selection }).state;
  return entry.state;
}
