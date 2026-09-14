import { describe, expect, it } from "vitest";
import { convertDbxSnippetToMonaco } from "../monacoSnippet";

describe("DBX persisted snippet conversion", () => {
  it("numbers named placeholders instead of interpreting them as Monaco variables", () => {
    expect(convertDbxSnippetToMonaco("SELECT ${column} FROM ${table}")).toBe("SELECT ${1:column} FROM ${2:table}");
  });

  it("links repeated placeholders", () => {
    expect(convertDbxSnippetToMonaco("${column} = ${column}")).toBe("${1:column} = ${1:column}");
  });

  it("retains numeric field ordering ahead of named fields", () => {
    expect(convertDbxSnippetToMonaco("${name} ${2:second} ${0:first} ${1:middle}")).toBe("${4:name} ${3:second} ${1:first} ${2:middle}");
  });

  it("keeps empty placeholders independent", () => {
    expect(convertDbxSnippetToMonaco("COALESCE(${}, ${})")).toBe("COALESCE(${1:}, ${2:})");
  });

  it("supports hash placeholders already accepted by DBX", () => {
    expect(convertDbxSnippetToMonaco("#{column} = ${column}")).toBe("${1:column} = ${1:column}");
  });

  it("does not turn PostgreSQL parameters or dollar quoting into snippet variables", () => {
    expect(convertDbxSnippetToMonaco("SELECT $1, $$body$$, ${column}")).toBe("SELECT \\$1, \\$\\$body\\$\\$, ${1:column}");
  });

  it("preserves literal braces and backslashes", () => {
    expect(convertDbxSnippetToMonaco(String.raw`SELECT '\{"key": 1\}', 'C:\temp'`)).toBe(String.raw`SELECT '{"key": 1\}', 'C:\\temp'`);
  });
});
