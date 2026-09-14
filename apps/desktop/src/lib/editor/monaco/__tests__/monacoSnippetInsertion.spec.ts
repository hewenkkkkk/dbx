import { describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { insertMonacoSnippet } from "../monacoSnippetInsertion";

describe("version-bounded native snippet insertion", () => {
  const range = { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 5 };
  it("uses the native controller in one step, retaining its placeholder and undo behavior", () => {
    const controller = { cancel: vi.fn(), insert: vi.fn() };
    const instance = { getContribution: vi.fn(() => controller), setSelection: vi.fn(), focus: vi.fn() };
    expect(insertMonacoSnippet(instance as unknown as editor.IStandaloneCodeEditor, range, "${1:value}, ${2:value}")).toBe(true);
    expect(instance.getContribution).toHaveBeenCalledWith("snippetController2");
    expect(controller.cancel).toHaveBeenCalledOnce();
    expect(instance.setSelection).toHaveBeenCalledWith(range);
    expect(controller.insert).toHaveBeenCalledExactlyOnceWith("${1:value}, ${2:value}");
  });
  it("leaves the editor untouched if the installed controller is incompatible", () => {
    const instance = { getContribution: () => null, setSelection: vi.fn(), focus: vi.fn() };
    expect(insertMonacoSnippet(instance as unknown as editor.IStandaloneCodeEditor, range, "${1:value}")).toBe(false);
    expect(instance.setSelection).not.toHaveBeenCalled();
    expect(instance.focus).not.toHaveBeenCalled();
  });
});
