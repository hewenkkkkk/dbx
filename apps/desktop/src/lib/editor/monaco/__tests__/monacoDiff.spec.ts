import { describe, expect, it } from "vitest";
import { summarizeMonacoDiff } from "../monacoDiff";

describe("Monaco diff summary", () => {
  it("counts pure additions and removals using the zero end-line sentinel", () => {
    expect(
      summarizeMonacoDiff([
        { originalStartLineNumber: 4, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 7 },
        { originalStartLineNumber: 12, originalEndLineNumber: 13, modifiedStartLineNumber: 14, modifiedEndLineNumber: 0 },
      ]),
    ).toEqual({ added: 3, removed: 2, modified: 0, changes: 2 });
  });

  it("separates modified lines from extra additions in a replacement", () => {
    expect(summarizeMonacoDiff([{ originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 2, modifiedEndLineNumber: 5 }])).toEqual({ added: 2, removed: 0, modified: 2, changes: 1 });
  });

  it("reports identical content as zero changes", () => {
    expect(summarizeMonacoDiff([])).toEqual({ added: 0, removed: 0, modified: 0, changes: 0 });
  });
});
