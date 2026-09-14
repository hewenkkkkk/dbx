import { describe, expect, it } from "vitest";
import { createMonacoTheme } from "../monacoTheme";
import { monacoLanguageForFormat } from "../monacoLanguage";
import type { CustomThemeColors, EditorTheme } from "@/stores/settingsStore";

describe("Monaco editor themes", () => {
  it.each<[EditorTheme, string, string]>([
    ["one-dark", "vs-dark", "#282c34"],
    ["vscode-light", "vs", "#ffffff"],
    ["nord", "vs-dark", "#2e3440"],
    ["idea-dark", "vs-dark", "#2b2b2b"],
    ["jetbrains-dark", "vs-dark", "#1e1f22"],
    ["duotone-light", "vs", "#faf8f5"],
  ])("preserves the %s theme appearance", (theme, base, background) => {
    const result = createMonacoTheme(theme, "dark", "pearl");
    expect(result.base).toBe(base);
    expect(result.colors["editor.background"].toLowerCase()).toBe(background);
  });

  it("follows the app palette and appearance", () => {
    expect(createMonacoTheme("app", "light", "idea")).toEqual(createMonacoTheme("idea-light", "dark", "pearl"));
    expect(createMonacoTheme("app", "dark", "vscode")).toEqual(createMonacoTheme("vscode-dark", "light", "pearl"));
  });

  it("preserves custom background and SQL token colors", () => {
    const colors = { keyword: "#112233", field: "#223344", table: "#334455", background: "#102030", foreground: "#eeeeee" } as CustomThemeColors;
    const result = createMonacoTheme("custom", "dark", "pearl", colors);
    expect(result.colors["editor.background"]).toBe("#102030");
    expect(result.colors["editorGutter.background"]).toBe("#102030");
    expect(result.rules).toContainEqual({ token: "table", foreground: "334455", fontStyle: "" });
    expect(result.rules).toContainEqual({ token: "property", foreground: "223344", fontStyle: "" });
  });
});

describe("Monaco format mapping", () => {
  it.each([
    ["kubernetes", "yaml"],
    ["yml", "yaml"],
    ["props", "ini"],
    ["properties", "ini"],
    ["base64", "plaintext"],
    ["text", "plaintext"],
    ["unknown", "plaintext"],
    [" SQL ", "sql"],
    ["json", "json"],
    ["nginx", "nginx"],
    ["toml", "toml"],
  ])("maps %s to %s", (format, language) => {
    expect(monacoLanguageForFormat(format)).toBe(language);
  });
});
