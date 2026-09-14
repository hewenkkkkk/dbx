import type { editor, IRange } from "monaco-editor";

interface SnippetContribution extends editor.IEditorContribution {
  insert(template: string): void;
  cancel(): void;
}

export function insertMonacoSnippet(instance: editor.IStandaloneCodeEditor, range: IRange, template: string): boolean {
  const controller = instance.getContribution<SnippetContribution>("snippetController2");
  if (!controller || typeof controller.insert !== "function" || typeof controller.cancel !== "function") return false;
  controller.cancel();
  instance.setSelection(range);
  controller.insert(template);
  instance.focus();
  return true;
}
