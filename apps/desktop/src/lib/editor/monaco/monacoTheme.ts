import type { editor } from "monaco-editor";
import type { CustomThemeColors, EditorTheme } from "@/stores/settingsStore";
import type { AppThemeAppearance, AppThemePalette } from "@/lib/app/appTheme";
import { IDE_EDITOR_THEMES, resolveEditorTheme, type IdeEditorThemeColors } from "@/lib/editor/editorThemePalette";
import { MONACO_COMMUNITY_THEME_COLORS } from "./monacoThemeColors";

const ideThemes: Partial<Record<EditorTheme, IdeEditorThemeColors>> = {
  "idea-light": IDE_EDITOR_THEMES.ideaLight,
  "idea-dark": IDE_EDITOR_THEMES.ideaDark,
  "jetbrains-light": IDE_EDITOR_THEMES.jetbrainsLight,
  "jetbrains-dark": IDE_EDITOR_THEMES.jetbrainsDark,
  "cursor-light": IDE_EDITOR_THEMES.cursorLight,
  "cursor-dark": IDE_EDITOR_THEMES.cursorDark,
  "claude-light": IDE_EDITOR_THEMES.claudeLight,
  "claude-dark": IDE_EDITOR_THEMES.claudeDark,
};

export function createMonacoTheme(theme: EditorTheme, appearance: AppThemeAppearance, palette: AppThemePalette, customColors?: CustomThemeColors): editor.IStandaloneThemeData {
  const resolved = resolveEditorTheme(theme, appearance, palette);
  const community = MONACO_COMMUNITY_THEME_COLORS[resolved as keyof typeof MONACO_COMMUNITY_THEME_COLORS];
  let colors: IdeEditorThemeColors = ideThemes[resolved] ?? community ?? MONACO_COMMUNITY_THEME_COLORS[appearance === "dark" ? "one-dark" : "vscode-light"];
  if (resolved === "custom") {
    colors = {
      ...colors,
      ...customColors,
      dark: appearance === "dark",
      background: customColors?.background ?? (appearance === "dark" ? "#1e1e2e" : "#fafafa"),
      foreground: customColors?.foreground ?? (appearance === "dark" ? "#cdd6f4" : "#1e1e2e"),
      property: customColors?.field ?? colors.property,
      gutterBackground: customColors?.background ?? (appearance === "dark" ? "#1e1e2e" : "#fafafa"),
    };
  }
  const rule = (token: string, color: string, fontStyle = ""): editor.ITokenThemeRule => ({ token, foreground: color.replace(/^#/, ""), fontStyle });
  return {
    base: colors.dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      rule("", colors.foreground),
      rule("keyword", colors.keyword, colors.keywordBold ? "bold" : ""),
      rule("string", colors.string, colors.stringBold ? "bold" : ""),
      rule("number", colors.number, colors.numberBold ? "bold" : ""),
      rule("comment", colors.comment, "italic"),
      rule("type", colors.type),
      rule("identifier", colors.variable),
      rule("function", colors.function),
      rule("predefined", colors.builtin),
      rule("operator", colors.operator),
      rule("delimiter", colors.punctuation),
      rule("property", colors.property),
      rule("table", colors.table),
      rule("tag", colors.tag),
      rule("attribute.name", colors.attribute),
      rule("attribute.value", colors.string),
      rule("metatag", colors.meta),
      rule("invalid", colors.invalid),
    ],
    colors: {
      "editor.background": colors.background,
      "editor.foreground": colors.foreground,
      "editorCursor.foreground": colors.cursor,
      "editor.selectionBackground": colors.selection,
      "editor.inactiveSelectionBackground": colors.selection,
      "editor.selectionHighlightBackground": colors.selectionMatch,
      "editor.lineHighlightBackground": colors.activeLine,
      "editorLineNumber.foreground": colors.gutterForeground,
      "editorLineNumber.activeForeground": colors.gutterActiveForeground,
      "editorGutter.background": colors.gutterBackground,
      "editorBracketMatch.background": colors.matchingBracket,
      "editorWidget.background": colors.background,
      "editorWidget.foreground": colors.foreground,
      "editorSuggestWidget.background": colors.background,
      "editorSuggestWidget.foreground": colors.foreground,
      "editorSuggestWidget.selectedBackground": colors.selection,
      "editorHoverWidget.background": colors.background,
      "editorHoverWidget.foreground": colors.foreground,
    },
  };
}
