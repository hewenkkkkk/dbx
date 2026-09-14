import { describe, expect, it } from "vitest";
import type { editor } from "monaco-editor";
import type { Monaco } from "../monaco";
import type { SqlCompletionItem } from "@/lib/sql/sqlCompletion";
import { createMonacoSqlCompletion } from "../monacoSqlCompletion";

const monaco = { languages: { CompletionItemKind: { Keyword: 1, Class: 2, Field: 3, Snippet: 4, Function: 5, Module: 6, Variable: 7, Text: 8 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } } } as unknown as Monaco;

function modelFor(value: string): editor.ITextModel {
  return {
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: Math.max(0, Math.min(offset, value.length)) + 1 }),
    getValueInRange: (range: { startColumn: number; endColumn: number }) => value.slice(range.startColumn - 1, range.endColumn - 1),
  } as unknown as editor.ITextModel;
}

describe("Monaco SQL completion adapter", () => {
  it("preserves snippet trigger text, display label and business ordering", () => {
    const item: SqlCompletionItem = { label: "SELECT *", filterText: "ssf", type: "snippet", apply: "SELECT * FROM ${table}", boost: 0 };
    expect(createMonacoSqlCompletion(monaco, modelFor("ssf"), item, { from: 0, to: 3, index: 9 })).toMatchObject({ label: "SELECT *", filterText: "ssf", sortText: "00000009", insertText: "SELECT * FROM ${1:table}", insertTextRules: 4 });
  });

  it("consumes the existing closing quote exactly once", () => {
    const item: SqlCompletionItem = { label: "Forms", type: "table", apply: '"Forms"', replaceClosingQuote: '"', boost: 0 };
    const completion = createMonacoSqlCompletion(monaco, modelFor('"Fo";'), item, { from: 0, to: 3, index: 0, insertSpace: true });
    expect(completion.range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 });
    expect(completion.insertText).toBe('"Forms"');
  });

  it("does not consume a mismatched closing delimiter", () => {
    const item: SqlCompletionItem = { label: "Forms", type: "table", apply: '"Forms"', replaceClosingQuote: '"', boost: 0 };
    expect(createMonacoSqlCompletion(monaco, modelFor('"Fo]'), item, { from: 0, to: 3, index: 0 }).range).toMatchObject({ endColumn: 4 });
  });

  it("uses the existing space-insertion policy", () => {
    const item: SqlCompletionItem = { label: "users", type: "table", boost: 0 };
    expect(createMonacoSqlCompletion(monaco, modelFor("us"), item, { from: 0, to: 2, index: 0, insertSpace: true }).insertText).toBe("users ");
    expect(createMonacoSqlCompletion(monaco, modelFor("us,"), item, { from: 0, to: 2, index: 0, insertSpace: true }).insertText).toBe("users");
  });

  it("triggers qualified-name completion after accepting a schema", () => {
    const item: SqlCompletionItem = { label: "public", type: "schema", apply: "public.", boost: 0 };
    expect(createMonacoSqlCompletion(monaco, modelFor("pub"), item, { from: 0, to: 3, index: 0 }).command?.id).toBe("editor.action.triggerSuggest");
  });

  it("keeps database documentation as untrusted plain text", () => {
    const item: SqlCompletionItem = { label: "users", type: "table", info: "[run](command:deleteAll)", boost: 0 };
    expect(createMonacoSqlCompletion(monaco, modelFor("us"), item, { from: 0, to: 2, index: 0 }).documentation).toBe(item.info);
  });
});
