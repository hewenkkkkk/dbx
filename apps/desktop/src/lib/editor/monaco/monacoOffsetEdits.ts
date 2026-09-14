import { ChangeSet, EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { editor } from "monaco-editor";
import { monacoRangeFromOffsets, type Monaco } from "./monaco";

export function applyMonacoOffsetEdits(monaco: Monaco, instance: editor.IStandaloneCodeEditor, spec: { changes?: ChangeSpec; selection?: EditorSelection | { anchor: number; head?: number }; scrollIntoView?: boolean; userEvent?: string }) {
  const model = instance.getModel();
  if (!model) return;
  const selections = () => {
    if (!spec.selection) return null;
    const ranges = spec.selection instanceof EditorSelection ? spec.selection.ranges : [spec.selection];
    return ranges.map((selection) => {
      const anchor = model.getPositionAt(selection.anchor);
      const head = model.getPositionAt(selection.head ?? selection.anchor);
      return new monaco.Selection(anchor.lineNumber, anchor.column, head.lineNumber, head.column);
    });
  };
  if (spec.changes) {
    const changes = ChangeSet.of(spec.changes, model.getValueLength(), "\n");
    const edits: editor.IIdentifiedSingleEditOperation[] = [];
    changes.iterChanges((from, to, _newFrom, _newTo, text) => edits.push({ range: monacoRangeFromOffsets(model, from, to), text: text.toString() }));
    instance.pushUndoStop();
    instance.executeEdits("dbx", edits, selections);
    instance.pushUndoStop();
  }
  const selection = selections();
  if (selection) instance.setSelections(selection);
  if (spec.scrollIntoView) {
    const position = instance.getPosition();
    if (position) instance.revealPositionInCenterIfOutsideViewport(position);
  }
}

export function monacoPositionAtCoords(instance: editor.IStandaloneCodeEditor, point: { x: number; y: number }): number | null {
  const target = instance.getTargetAtClientPoint(point.x, point.y);
  return target?.position ? (instance.getModel()?.getOffsetAt(target.position) ?? null) : null;
}

export function monacoCoordsAtOffset(instance: editor.IStandaloneCodeEditor, offset: number) {
  const model = instance.getModel();
  const container = instance.getDomNode();
  if (!model || !container) return null;
  const position = instance.getScrolledVisiblePosition(model.getPositionAt(offset));
  if (!position) return null;
  const rect = container.getBoundingClientRect();
  return { left: rect.left + position.left, right: rect.left + position.left + 1, top: rect.top + position.top, bottom: rect.top + position.top + position.height };
}

export function monacoVisibleOffsetRanges(instance: editor.IStandaloneCodeEditor) {
  const model = instance.getModel();
  return model ? instance.getVisibleRanges().map((range) => ({ from: model.getOffsetAt(range.getStartPosition()), to: model.getOffsetAt(range.getEndPosition()) })) : [];
}
