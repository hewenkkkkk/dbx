import type { editor } from "monaco-editor";

export interface MonacoDiffSummary {
  added: number;
  removed: number;
  modified: number;
  changes: number;
}

export function summarizeMonacoDiff(changes: readonly editor.ILineChange[]): MonacoDiffSummary {
  const summary = { added: 0, removed: 0, modified: 0, changes: changes.length };
  for (const change of changes) {
    const removed = change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1;
    const added = change.modifiedEndLineNumber === 0 ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
    const modified = Math.min(added, removed);
    summary.modified += modified;
    summary.added += added - modified;
    summary.removed += removed - modified;
  }
  return summary;
}
