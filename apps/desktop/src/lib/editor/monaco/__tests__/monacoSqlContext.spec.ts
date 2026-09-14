import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "@codemirror/lang-sql";
import { syntaxTree } from "@codemirror/language";
import type { editor } from "monaco-editor";
import { attachMonacoSqlContext, monacoSqlContextState } from "../monacoSqlContext";

function createModel(initial: string) {
  let value = initial;
  const changes = new Set<(event: editor.IModelContentChangedEvent) => void>();
  const disposals = new Set<() => void>();
  const model = {
    getValue: () => value,
    onDidChangeContent: (listener: (event: editor.IModelContentChangedEvent) => void) => {
      changes.add(listener);
      return { dispose: () => changes.delete(listener) };
    },
    onWillDispose: (listener: () => void) => {
      disposals.add(listener);
      return { dispose: () => disposals.delete(listener) };
    },
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
      const lines = value.split("\n");
      return lines.slice(0, lineNumber - 1).reduce((offset, line) => offset + line.length + 1, 0) + column - 1;
    },
  } as unknown as editor.ITextModel;
  let selection = { anchor: { lineNumber: 1, column: 1 }, head: { lineNumber: 1, column: 1 } };
  const instance = {
    getModel: () => model,
    getSelections: () => [{ getSelectionStart: () => selection.anchor, getPosition: () => selection.head }],
  } as unknown as editor.IStandaloneCodeEditor;
  return {
    model,
    instance,
    select: (anchor: typeof selection.anchor, head: typeof selection.head) => {
      selection = { anchor, head };
    },
    change: (next: string, edits: { rangeOffset: number; rangeLength: number; text: string }[], options = {}) => {
      value = next;
      for (const listener of changes) listener({ changes: edits, ...options } as editor.IModelContentChangedEvent);
    },
    dispose: () => {
      for (const listener of disposals) listener();
    },
    listenerCount: () => changes.size,
  };
}

afterEach(() => vi.useRealTimers());

describe("Monaco SQL parser context", () => {
  it("maintains the existing grammar without creating an editor view", () => {
    const fixture = createModel('SELECT "column" FROM users;');
    const context = attachMonacoSqlContext(fixture.model, sql().language);
    expect(monacoSqlContextState(fixture.instance).doc.toString()).toBe('SELECT "column" FROM users;');
    expect(syntaxTree(monacoSqlContextState(fixture.instance)).toString()).toContain("Statement");
    context.dispose();
  });

  it("applies simultaneous Monaco offsets against the same old document", () => {
    const fixture = createModel("SELECT a, b;");
    const context = attachMonacoSqlContext(fixture.model, sql().language);
    fixture.change("SELECT alpha, beta;", [
      { rangeOffset: 10, rangeLength: 1, text: "beta" },
      { rangeOffset: 7, rangeLength: 1, text: "alpha" },
    ]);
    expect(monacoSqlContextState(fixture.instance).doc.toString()).toBe("SELECT alpha, beta;");
    context.dispose();
  });

  it("preserves CRLF offsets, Unicode and backward selections", () => {
    const fixture = createModel("SELECT '中文';\r\nSELECT '😀';");
    const context = attachMonacoSqlContext(fixture.model, sql().language);
    fixture.select({ lineNumber: 2, column: 12 }, { lineNumber: 2, column: 8 });
    const state = monacoSqlContextState(fixture.instance);
    expect(state.doc.toString()).toBe(fixture.model.getValue());
    expect(state.selection.main.anchor).toBe(fixture.model.getOffsetAt({ lineNumber: 2, column: 12 }));
    expect(state.selection.main.head).toBe(fixture.model.getOffsetAt({ lineNumber: 2, column: 8 }));
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("'😀'");
    context.dispose();
  });

  it("resynchronizes EOL-only changes and full model resets", () => {
    const fixture = createModel("SELECT 1;\nSELECT 2;");
    const context = attachMonacoSqlContext(fixture.model, sql().language);
    fixture.change("SELECT 1;\r\nSELECT 2;", [], { isEolChange: true });
    expect(monacoSqlContextState(fixture.instance).doc.toString()).toBe(fixture.model.getValue());
    fixture.change("SELECT 3;", [], { isFlush: true });
    expect(monacoSqlContextState(fixture.instance).doc.toString()).toBe("SELECT 3;");
    context.dispose();
  });

  it("publishes the completed background syntax tree", async () => {
    vi.useFakeTimers();
    const fixture = createModel("SELECT users.id FROM users;\n".repeat(2_000));
    const context = attachMonacoSqlContext(fixture.model, sql().language);
    await vi.advanceTimersByTimeAsync(5_000);
    const state = monacoSqlContextState(fixture.instance);
    expect(syntaxTree(state).length).toBe(state.doc.length);
    expect(vi.getTimerCount()).toBe(0);
    context.dispose();
  });

  it("does not spin forever without a SQL language", async () => {
    vi.useFakeTimers();
    const fixture = createModel("plain text");
    const context = attachMonacoSqlContext(fixture.model, []);
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(0);
    context.dispose();
  });

  it("releases parser work and listeners with the model", () => {
    vi.useFakeTimers();
    const fixture = createModel("SELECT 1;");
    attachMonacoSqlContext(fixture.model, sql().language);
    fixture.dispose();
    expect(fixture.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => monacoSqlContextState(fixture.instance)).toThrow("no parser context");
  });
});
