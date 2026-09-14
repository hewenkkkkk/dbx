import { batchColumnSelectionColumnList, batchColumnSelectionInsertReplacement, batchColumnSelectionReplaceTo } from "@/lib/editor/batchColumnSelection";
import type { MonacoCompletionCandidate } from "./monacoSqlCompletion";
import { convertDbxSnippetToMonaco, escapeMonacoSnippetLiteral } from "./monacoSnippet";

export interface MonacoColumnChoice {
  key: string;
  label: string;
  detail?: string;
  apply: string;
}

export interface MonacoColumnSelection {
  document: string;
  from: number;
  to: number;
  mode: "select" | "insert";
  qualifier?: string;
  replaceClosingQuote?: string;
  choices: MonacoColumnChoice[];
}

export function createMonacoColumnSelection(items: readonly MonacoCompletionCandidate[], document: string, from: number, to: number): MonacoColumnSelection | null {
  const first = items.find((item) => item.type === "column" && item.batchSelectionMode && item.apply);
  if (!first?.batchSelectionMode) return null;
  const seen = new Set<string>();
  const choices = items
    .filter((item) => item.type === "column" && item.batchSelectionMode === first.batchSelectionMode && item.apply)
    .flatMap((item) => {
      const key = item.apply!;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: item.label, detail: item.detail, apply: key }];
    });
  return { document, from, to, mode: first.batchSelectionMode, qualifier: first.batchSelectionQualifier, replaceClosingQuote: first.replaceClosingQuote, choices };
}

export function buildMonacoColumnInsertion(selection: MonacoColumnSelection, keys: readonly string[], valuesKeyword: "values" | "VALUES") {
  const selected = new Set(keys);
  const choices = selection.choices.filter((choice) => selected.has(choice.key));
  if (!choices.length) return null;
  const columns = batchColumnSelectionColumnList(
    choices.map((choice) => choice.apply),
    selection.mode,
    selection.qualifier,
  );
  if (selection.mode === "select") {
    const to = batchColumnSelectionReplaceTo({ to: selection.to, mode: selection.mode, nextCharacter: selection.document[selection.to] ?? "", replaceClosingQuote: selection.replaceClosingQuote });
    return { from: selection.from, to, text: columns, monacoSnippet: undefined as string | undefined };
  }
  const quotedTo = selection.replaceClosingQuote && selection.document[selection.to] === selection.replaceClosingQuote ? selection.to + 1 : selection.to;
  const replacement = batchColumnSelectionInsertReplacement({ document: selection.document, to: quotedTo, columns, valueCount: choices.length, valuesKeyword });
  return { from: selection.from, to: replacement.replaceTo, text: replacement.insert, monacoSnippet: escapeMonacoSnippetLiteral(columns) + convertDbxSnippetToMonaco(replacement.insert.slice(columns.length)) };
}
