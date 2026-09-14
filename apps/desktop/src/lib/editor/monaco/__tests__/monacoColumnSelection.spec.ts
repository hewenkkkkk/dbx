import { describe, expect, it } from "vitest";
import { buildMonacoColumnInsertion, createMonacoColumnSelection } from "../monacoColumnSelection";
import type { MonacoCompletionCandidate } from "../monacoSqlCompletion";

function column(apply: string, mode: "select" | "insert", extra: Partial<MonacoCompletionCandidate> = {}): MonacoCompletionCandidate {
  return { label: apply, apply, type: "column", batchSelectionMode: mode, ...extra };
}

describe("Monaco multi-column insertion", () => {
  it("offers only supported columns, deduplicating expressions in metadata order", () => {
    const selection = createMonacoColumnSelection([column("id", "select"), column("id", "select"), { label: "SELECT", type: "keyword" }, column("name", "select")], "SELECT  FROM users", 7, 7)!;
    expect(selection.choices.map((choice) => choice.key)).toEqual(["id", "name"]);
    expect(buildMonacoColumnInsertion(selection, ["name", "id"], "VALUES")?.text).toBe("id, name");
  });

  it("keeps qualifiers and consumes the existing closing quote exactly once", () => {
    const selection = createMonacoColumnSelection([column('"id"', "select", { batchSelectionQualifier: '"u"', replaceClosingQuote: '"' }), column('"name"', "select")], 'SELECT "u"."i" FROM users u', 11, 13)!;
    const insertion = buildMonacoColumnInsertion(selection, ['"id"', '"name"'], "VALUES")!;
    expect(insertion.text).toBe('"id", "u"."name"');
    expect(insertion.to).toBe(14);
    expect(insertion.monacoSnippet).toBeUndefined();
  });

  it("restores INSERT column lists with native numbered VALUES placeholders", () => {
    const document = "INSERT INTO users ()";
    const selection = createMonacoColumnSelection([column("id", "insert"), column("name", "insert")], document, 19, 19)!;
    const insertion = buildMonacoColumnInsertion(selection, ["id", "name"], "VALUES")!;
    expect(insertion.to).toBe(document.length);
    expect(insertion.monacoSnippet).toBe("id, name) VALUES (${1:value}, ${2:value})");
  });

  it("does not duplicate an existing VALUES clause", () => {
    const document = "INSERT INTO users () VALUES (1, 2)";
    const selection = createMonacoColumnSelection([column("id", "insert"), column("name", "insert")], document, 19, 19)!;
    const insertion = buildMonacoColumnInsertion(selection, ["id", "name"], "VALUES")!;
    expect(document.slice(0, insertion.from) + insertion.text + document.slice(insertion.to)).toBe("INSERT INTO users (id, name) VALUES (1, 2)");
  });

  it("treats snippet-looking database identifiers as literal SQL", () => {
    const selection = createMonacoColumnSelection([column('"${bad}"', "insert"), column('"a\\b"', "insert")], "INSERT INTO users ()", 19, 19)!;
    const insertion = buildMonacoColumnInsertion(selection, ['"${bad}"', '"a\\b"'], "values")!;
    expect(insertion.monacoSnippet).toBe('"\\${bad\\}", "a\\\\b") values (${1:value}, ${2:value})');
  });

  it("does not create an insertion for empty or stale selections", () => {
    const selection = createMonacoColumnSelection([column("id", "select")], "SELECT ", 7, 7)!;
    expect(buildMonacoColumnInsertion(selection, [], "VALUES")).toBeNull();
    expect(buildMonacoColumnInsertion(selection, ["removed"], "VALUES")).toBeNull();
    expect(createMonacoColumnSelection([{ label: "SELECT", type: "keyword" }], "", 0, 0)).toBeNull();
  });
});
