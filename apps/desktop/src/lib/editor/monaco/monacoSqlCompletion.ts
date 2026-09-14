import type { editor, languages } from "monaco-editor";
import type { SqlCompletionItem } from "@/lib/sql/sqlCompletion";
import { appendSqlCompletionSpace } from "@/lib/editor/sqlCompletionInsertion";
import { monacoRangeFromOffsets, type Monaco } from "./monaco";
import { convertDbxSnippetToMonaco } from "./monacoSnippet";

export interface MonacoSqlCompletionOptions {
  from: number;
  to: number;
  index: number;
  insertSpace?: boolean;
  command?: languages.Command;
}

export type MonacoCompletionCandidate = Omit<SqlCompletionItem, "type" | "boost"> & { type: SqlCompletionItem["type"] | "property"; boost?: number; applyAsSnippet?: boolean; appendSpace?: boolean; monacoSnippet?: string };

export function createMonacoSqlCompletion(monaco: Monaco, model: editor.ITextModel, item: MonacoCompletionCandidate, options: MonacoSqlCompletionOptions): languages.CompletionItem {
  const kinds = monaco.languages.CompletionItemKind;
  const kind = {
    keyword: kinds.Keyword,
    table: kinds.Class,
    column: kinds.Field,
    snippet: kinds.Snippet,
    function: kinds.Function,
    schema: kinds.Module,
    variable: kinds.Variable,
    text: kinds.Text,
    property: kinds.Property,
  }[item.type];
  let to = options.to;
  if (item.replaceClosingQuote && model.getValueInRange(monacoRangeFromOffsets(model, to, to + 1)) === item.replaceClosingQuote) to++;
  const isSnippet = item.monacoSnippet !== undefined || ((item.applyAsSnippet || item.type === "snippet" || item.type === "function") && Boolean(item.apply));
  const text = item.apply ?? item.label;
  const insertText = isSnippet
    ? (item.monacoSnippet ?? convertDbxSnippetToMonaco(text))
    : appendSqlCompletionSpace(text, {
        enabled: item.appendSpace || (options.insertSpace ?? false),
        itemType: item.type,
        nextCharacter: model.getValueInRange(monacoRangeFromOffsets(model, to, to + 1)),
      });
  const command = options.command ?? (item.type === "schema" && item.apply?.endsWith(".") ? { id: "editor.action.triggerSuggest", title: "Complete qualified name" } : undefined);
  return {
    label: item.label,
    kind,
    detail: item.detail,
    documentation: item.info,
    filterText: item.filterText ?? item.label,
    sortText: String(options.index).padStart(8, "0"),
    insertText,
    ...(isSnippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
    range: monacoRangeFromOffsets(model, options.from, to),
    ...(command ? { command } : {}),
  };
}
