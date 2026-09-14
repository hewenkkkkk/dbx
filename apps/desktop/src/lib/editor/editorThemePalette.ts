import type { EditorTheme } from "@/stores/settingsStore";
import { customUiAppearance, type AppCustomUiColors, type AppThemeAppearance, type AppThemePalette } from "@/lib/app/appTheme";

export type IdeEditorThemeColors = {
  dark: boolean;
  background: string;
  foreground: string;
  selection: string;
  selectionMatch: string;
  cursor: string;
  gutterBackground: string;
  gutterForeground: string;
  gutterActiveForeground: string;
  activeLine: string;
  matchingBracket: string;
  gutterBorder: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  type: string;
  variable: string;
  function: string;
  operator: string;
  punctuation: string;
  property: string;
  table: string;
  builtin: string;
  meta: string;
  invalid: string;
  tag: string;
  attribute: string;
  className: string;
  keywordBold?: boolean;
  stringBold?: boolean;
  numberBold?: boolean;
};

export const IDE_EDITOR_THEMES = {
  ideaLight: {
    dark: false,
    background: "#ffffff",
    foreground: "#080808",
    selection: "#a6d2ff",
    selectionMatch: "#93d9d9",
    cursor: "#000000",
    gutterBackground: "#f2f2f2",
    gutterForeground: "#adadad",
    gutterActiveForeground: "#767a8a",
    activeLine: "#fcfaed",
    matchingBracket: "#93d9d9",
    gutterBorder: "#d4d4d4",
    keyword: "#0033b3",
    string: "#067d17",
    number: "#1750eb",
    comment: "#8c8c8c",
    type: "#0033b3",
    variable: "#174ad4",
    function: "#00627a",
    operator: "#080808",
    punctuation: "#080808",
    property: "#871094",
    table: "#871094",
    builtin: "#0033b3",
    meta: "#9e880d",
    invalid: "#f50000",
    tag: "#0033b3",
    attribute: "#871094",
    className: "#174be6",
    keywordBold: true,
    stringBold: true,
    numberBold: true,
  },
  ideaDark: {
    dark: true,
    background: "#2b2b2b",
    foreground: "#a9b7c6",
    selection: "#214283",
    selectionMatch: "#3b514d",
    cursor: "#bbbbbb",
    gutterBackground: "#313335",
    gutterForeground: "#606366",
    gutterActiveForeground: "#a4a3a3",
    activeLine: "#323232",
    matchingBracket: "#3b514d",
    gutterBorder: "#4d4d4d",
    keyword: "#cc7832",
    string: "#6a8759",
    number: "#6897bb",
    comment: "#808080",
    type: "#a9b7c6",
    variable: "#a9b7c6",
    function: "#ffc66d",
    operator: "#cc7832",
    punctuation: "#a9b7c6",
    property: "#9876aa",
    table: "#9876aa",
    builtin: "#cc7832",
    meta: "#bbb529",
    invalid: "#ff0000",
    tag: "#e8bf6a",
    attribute: "#bababa",
    className: "#a9b7c6",
  },
  jetbrainsLight: {
    dark: false,
    background: "#ffffff",
    foreground: "#080808",
    selection: "#a6d2ff",
    selectionMatch: "#c9ecec",
    cursor: "#000000",
    gutterBackground: "#ffffff",
    gutterForeground: "#aeb3c2",
    gutterActiveForeground: "#767a8a",
    activeLine: "#f5f8fe",
    matchingBracket: "#93d9d9",
    gutterBorder: "#ebecf0",
    keyword: "#0033b3",
    string: "#067d17",
    number: "#1750eb",
    comment: "#8c8c8c",
    type: "#0033b3",
    variable: "#174ad4",
    function: "#00627a",
    operator: "#080808",
    punctuation: "#080808",
    property: "#871094",
    table: "#871094",
    builtin: "#0033b3",
    meta: "#9e880d",
    invalid: "#f50000",
    tag: "#0033b3",
    attribute: "#871094",
    className: "#174be6",
    keywordBold: true,
    stringBold: true,
    numberBold: true,
  },
  jetbrainsDark: {
    dark: true,
    background: "#1e1f22",
    foreground: "#bcbec4",
    selection: "#2e436e",
    selectionMatch: "#114957",
    cursor: "#ced0d6",
    gutterBackground: "#1e1f22",
    gutterForeground: "#4b5059",
    gutterActiveForeground: "#a1a3ab",
    activeLine: "#26282e",
    matchingBracket: "#43454a",
    gutterBorder: "#313438",
    keyword: "#cf8e6d",
    string: "#6aab73",
    number: "#2aacb8",
    comment: "#7a7e85",
    type: "#cf8e6d",
    variable: "#bcbec4",
    function: "#56a8f5",
    operator: "#bcbec4",
    punctuation: "#bcbec4",
    property: "#c77dbb",
    table: "#c77dbb",
    builtin: "#cf8e6d",
    meta: "#b3ae60",
    invalid: "#f75464",
    tag: "#2fbaa3",
    attribute: "#b3ae60",
    className: "#56a8f5",
  },
  cursorLight: {
    dark: false,
    background: "#fcfcfc",
    foreground: "#141414eb",
    selection: "#1414141e",
    selectionMatch: "#14141411",
    cursor: "#141414eb",
    gutterBackground: "#fcfcfc",
    gutterForeground: "#1414147a",
    gutterActiveForeground: "#141414ad",
    activeLine: "#ededed",
    matchingBracket: "#1414141e",
    gutterBorder: "#14141413",
    keyword: "#b3003f",
    string: "#9e94d5",
    number: "#b8448b",
    comment: "#141414ad",
    type: "#206595",
    variable: "#206595",
    function: "#db704b",
    operator: "#b3003f",
    punctuation: "#141414eb",
    property: "#1f8a65",
    table: "#1f8a65",
    builtin: "#206595",
    meta: "#1f8a65",
    invalid: "#cf2d56",
    tag: "#206595",
    attribute: "#6049b3",
    className: "#206595",
  },
  cursorDark: {
    dark: true,
    background: "#181818",
    foreground: "#e4e4e4eb",
    selection: "#40404099",
    selectionMatch: "#404040cc",
    cursor: "#e4e4e4eb",
    gutterBackground: "#181818",
    gutterForeground: "#e4e4e442",
    gutterActiveForeground: "#e4e4e4eb",
    activeLine: "#262626",
    matchingBracket: "#e4e4e41e",
    gutterBorder: "#e4e4e413",
    keyword: "#82d2ce",
    string: "#e394dc",
    number: "#ebc88d",
    comment: "#e4e4e45e",
    type: "#efb080",
    variable: "#87c3ff",
    function: "#efb080",
    operator: "#d6d6dd",
    punctuation: "#d6d6dd",
    property: "#82d2ce",
    table: "#aaa0fa",
    builtin: "#a8cc7c",
    meta: "#a8cc7c",
    invalid: "#e34671",
    tag: "#82d2ce",
    attribute: "#aaa0fa",
    className: "#efb080",
  },
  claudeLight: {
    dark: false,
    background: "#fffdf8",
    foreground: "#302820",
    selection: "#ead8c6",
    selectionMatch: "#e7d8c8",
    cursor: "#b86b3c",
    gutterBackground: "#f8f1e9",
    gutterForeground: "#9a7f66",
    gutterActiveForeground: "#5f4b3a",
    activeLine: "#f4e9de",
    matchingBracket: "#e2c9b1",
    gutterBorder: "#ddcdbb",
    keyword: "#9a4f2e",
    string: "#4f7d5d",
    number: "#2d6f91",
    comment: "#8c745f",
    type: "#7a5aa8",
    variable: "#3e5f75",
    function: "#b86b3c",
    operator: "#6b5544",
    punctuation: "#6b5544",
    property: "#9a4f2e",
    table: "#7a5aa8",
    builtin: "#4f7d5d",
    meta: "#8f6b2e",
    invalid: "#c3493d",
    tag: "#7a5aa8",
    attribute: "#b86b3c",
    className: "#7a5aa8",
  },
  claudeDark: {
    dark: true,
    background: "#211f1c",
    foreground: "#d8d0c4",
    selection: "#44382f",
    selectionMatch: "#564539",
    cursor: "#d28a5f",
    gutterBackground: "#1b1917",
    gutterForeground: "#8f7f70",
    gutterActiveForeground: "#d8d0c4",
    activeLine: "#2a2723",
    matchingBracket: "#564539",
    gutterBorder: "#7f6c5b59",
    keyword: "#d28a5f",
    string: "#74b195",
    number: "#65a1c6",
    comment: "#a39686",
    type: "#a08fcd",
    variable: "#d8d0c4",
    function: "#d69a6b",
    operator: "#e0d0c0",
    punctuation: "#c9b9a7",
    property: "#d28a5f",
    table: "#a08fcd",
    builtin: "#74b195",
    meta: "#d4ae63",
    invalid: "#e2675f",
    tag: "#a08fcd",
    attribute: "#d69a6b",
    className: "#a08fcd",
  },
} satisfies Record<string, IdeEditorThemeColors>;

export function resolveEditorTheme(theme: EditorTheme, appAppearance: AppThemeAppearance, appPalette: AppThemePalette = "pearl"): Exclude<EditorTheme, "app"> {
  if (theme === "app") {
    switch (appPalette) {
      case "vscode":
        return appAppearance === "dark" ? "vscode-dark" : "vscode-light";
      case "idea":
        return appAppearance === "dark" ? "idea-dark" : "idea-light";
      case "xcode":
        return appAppearance === "dark" ? "xcode-dark" : "xcode";
      case "jetbrains":
        return appAppearance === "dark" ? "jetbrains-dark" : "jetbrains-light";
      case "cursor":
        return appAppearance === "dark" ? "cursor-dark" : "cursor-light";
      case "claude":
        return appAppearance === "dark" ? "claude-dark" : "claude-light";
      case "custom":
        // The custom UI palette routes the follow-app editor to verified,
        // self-consistent themes. The caller derives appAppearance from the
        // actual custom background luminance, so dark backgrounds pick the
        // dark theme and light backgrounds the light theme.
        return appAppearance === "dark" ? "one-dark" : "vscode-light";
      default:
        return appAppearance === "dark" ? "one-dark" : "vscode-light";
    }
  }
  return theme;
}

/**
 * Effective appearance for the "Follow app theme" editor: with the custom UI
 * palette the mode's light/dark flag is replaced by the custom background's
 * luminance, keeping tokens, selection, cursor, search matches and diagnostics
 * readable on arbitrarily dark/light custom backgrounds. Other palettes keep
 * the previous appearance unchanged.
 */
export function editorThemeAppearanceFor(appAppearance: AppThemeAppearance, appPalette: AppThemePalette, customUiColors?: AppCustomUiColors): AppThemeAppearance {
  if (appPalette === "custom" && customUiColors) return customUiAppearance(customUiColors);
  return appAppearance;
}

/**
 * Diagnostic marker colors for the editor surface, chosen from the resolved
 * editor appearance so error/warning underlines stay legible on the actual
 * editor background instead of using app-level warning/destructive tokens.
 */
export function editorDiagnosticColors(appearance: AppThemeAppearance): { error: string; warning: string } {
  return appearance === "dark" ? { error: "#f87171", warning: "#fbbf24" } : { error: "#dc2626", warning: "#b45309" };
}
