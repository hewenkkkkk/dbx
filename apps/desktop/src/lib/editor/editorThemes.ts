import type { Extension } from "@codemirror/state";
import type { EditorTheme, CustomThemeColors } from "@/stores/settingsStore";
import type { AppThemeAppearance, AppThemePalette } from "@/lib/app/appTheme";
import { IDE_EDITOR_THEMES, resolveEditorTheme, type IdeEditorThemeColors } from "@/lib/editor/editorThemePalette";
export { resolveEditorTheme, editorThemeAppearanceFor, editorDiagnosticColors } from "@/lib/editor/editorThemePalette";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// @codemirror/lang-sql tags dialect builtin-list words (COUNT, DATE_FORMAT, ...) as
// standard(name) — not standard(variableName), which is a *child* tag of name and so never
// matches a token tagged with the parent. Shared so both editor theme builders below stay in
// sync with what the SQL tokenizer actually emits.
export const SQL_BUILTIN_HIGHLIGHT_TAG = tags.standard(tags.name);

type CodeMirrorStyleSpec = Parameters<typeof import("@codemirror/view").EditorView.theme>[0];
type LucideIconNode = Array<[string, Record<string, string>]>;

export const EDITOR_FONT_SIZE_CSS_VAR = "--dbx-editor-font-size";
export const EDITOR_FONT_FAMILY_CSS_VAR = "--dbx-editor-font-family";
export const SQL_TABLE_COLOR_CSS_VAR = "--dbx-sql-table-color";
const EDITOR_SELECTION_BACKGROUND_CSS_VAR = "--dbx-editor-selection-background";

export function createRunStatementButtonDom(ariaLabel = "Execute statement"): HTMLButtonElement {
  const marker = document.createElement("button");
  marker.className = "cm-run-statement-marker cm-run-statement-marker--active";
  marker.setAttribute("type", "button");
  marker.setAttribute("aria-label", ariaLabel);
  marker.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"></path></svg>';
  return marker;
}

export function sqlSemanticHighlightTheme(EditorView: typeof import("@codemirror/view").EditorView): Extension {
  return EditorView.theme({
    ".cm-sql-table-name, .cm-sql-table-name *": {
      // Built-in CodeMirror themes do not define the editor-specific table color
      // variable. Keep semantic table names visible there as well, while custom
      // and IDE themes continue to use their configured table color.
      color: `var(${SQL_TABLE_COLOR_CSS_VAR}, #b4530b) !important`,
    },
  });
}

// MongoDB and other shell-style editors keep the SQL grammar, so their `//` comments are decorated
// manually. The decoration carries the active theme's comment highlight class, so it only has to
// keep the SQL grammar's colours from leaking through on the tokens it wraps.
export function shellLineCommentTheme(EditorView: typeof import("@codemirror/view").EditorView): Extension {
  return EditorView.theme({
    ".cm-shell-line-comment": {
      fontStyle: "italic",
    },
    ".cm-shell-line-comment *": {
      color: "inherit !important",
      fontStyle: "italic",
    },
  });
}

const SUPPORTS_COLOR_MIX = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", "color-mix(in oklch, black 50%, white)");
const SUPPORTS_OKLCH = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", "oklch(0.62 0.19 255)");

// ==================== 自定义主题配置 ====================
// 在这里修改你喜欢的颜色！

const customThemeColors = {
  lineNumber: "#6c7086", // 行号颜色
  lineNumberActive: "#cdd6f4", // 当前行号颜色
  selection: "#313244", // 选中文本背景
  cursor: "#f5e0dc", // 光标颜色

  // 语法高亮颜色
  keyword: "#cba6f7", // 关键字 (SELECT, FROM, WHERE 等)
  string: "#a6e3a1", // 字符串
  number: "#fab387", // 数字
  comment: "#6c7086", // 注释
  type: "#89b4fa", // 类型 (INTEGER, TEXT 等)
  variable: "#f38ba8", // 变量
  function: "#89dceb", // 函数
  operator: "#89b4fa", // 运算符
  punctuation: "#9399b2", // 标点符号
  property: "#f9e2af", // 属性/字段名
  tag: "#cba6f7", // XML/HTML 标签
  attribute: "#fab387", // 属性名
  className: "#f9e2af", // 类名

  // UI 元素
  gutterBackground: "#181825", // 侧边栏背景
  activeLine: "#313244", // 当前行高亮
  matchingBracket: "#45475a", // 匹配括号背景

  // 特殊
  builtin: "#89dceb", // 内置函数
  meta: "#cdd6f4", // 元信息
  invalid: "#f38ba8", // 无效字符
};

export function resolveCustomThemeBackgrounds(colors?: Pick<CustomThemeColors, "background">, isDark: boolean = true): { background: string; gutterBackground: string } {
  return {
    background: colors?.background ?? (isDark ? "#1e1e2e" : "#fafafa"),
    gutterBackground: colors?.background ?? customThemeColors.gutterBackground,
  };
}

/** 创建自定义 CodeMirror 主题 */
function createCustomTheme(EditorView: typeof import("@codemirror/view").EditorView, colors?: CustomThemeColors, isDark: boolean = true): Extension {
  // 根据系统主题设置默认背景色和前景色
  const backgrounds = resolveCustomThemeBackgrounds(colors, isDark);
  const defaultColors = { background: backgrounds.background, foreground: isDark ? "#cdd6f4" : "#242424" };

  const c = { ...defaultColors, ...customThemeColors, ...colors, gutterBackground: backgrounds.gutterBackground };

  // 映射用户自定义属性名到 CodeMirror 内部属性名
  if (colors) {
    if (colors.field) {
      c.variable = colors.field;
      c.property = colors.field;
    }
  }
  const tableColor = colors?.table || c.property;

  const theme = EditorView.theme(
    {
      "&": {
        backgroundColor: c.background,
        color: c.foreground,
        [EDITOR_SELECTION_BACKGROUND_CSS_VAR]: c.selection,
        [SQL_TABLE_COLOR_CSS_VAR]: tableColor,
      },
      ".cm-content": {
        caretColor: c.cursor,
      },
      ".cm-cursor": {
        borderLeftColor: c.cursor,
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: c.selection,
      },
      ".cm-activeLine": {
        backgroundColor: c.activeLine,
      },
      ".cm-gutters": {
        backgroundColor: c.gutterBackground,
        color: c.lineNumber,
        borderRight: "1px solid #313244",
      },
      ".cm-activeLineGutter": {
        backgroundColor: c.activeLine,
        color: c.lineNumberActive,
      },
      ".cm-matchingBracket": {
        backgroundColor: c.matchingBracket,
        outline: "none",
      },
    },
    { dark: isDark },
  );

  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: c.keyword },
    { tag: tags.controlKeyword, color: c.keyword },
    { tag: tags.definitionKeyword, color: c.keyword },
    { tag: tags.moduleKeyword, color: c.keyword },
    { tag: tags.operatorKeyword, color: c.keyword },
    { tag: tags.string, color: c.string },
    { tag: tags.special(tags.string), color: c.string },
    { tag: tags.number, color: c.number },
    { tag: tags.integer, color: c.number },
    { tag: tags.float, color: c.number },
    { tag: tags.comment, color: c.comment, fontStyle: "italic" },
    { tag: tags.lineComment, color: c.comment, fontStyle: "italic" },
    { tag: tags.blockComment, color: c.comment, fontStyle: "italic" },
    { tag: tags.typeName, color: c.type },
    { tag: tags.typeOperator, color: c.type },
    { tag: tags.name, color: c.variable }, // ← 添加：普通标识符（字段名、表名等）
    { tag: tags.variableName, color: c.variable },
    { tag: tags.definition(tags.variableName), color: c.variable },
    { tag: tags.function(tags.variableName), color: c.function },
    { tag: tags.function(tags.propertyName), color: c.function },
    { tag: SQL_BUILTIN_HIGHLIGHT_TAG, color: c.builtin },
    { tag: tags.propertyName, color: c.property },
    { tag: tags.operator, color: c.operator },
    { tag: tags.compareOperator, color: c.operator },
    { tag: tags.logicOperator, color: c.operator },
    { tag: tags.arithmeticOperator, color: c.operator },
    { tag: tags.punctuation, color: c.punctuation },
    { tag: tags.paren, color: c.punctuation },
    { tag: tags.brace, color: c.punctuation },
    { tag: tags.bracket, color: c.punctuation },
    { tag: tags.tagName, color: c.tag },
    { tag: tags.attributeName, color: c.attribute },
    { tag: tags.attributeValue, color: c.string },
    { tag: tags.className, color: c.className },
    { tag: tags.bool, color: c.keyword },
    { tag: tags.null, color: c.keyword },
    { tag: tags.meta, color: c.meta },
    { tag: tags.invalid, color: c.invalid },
    { tag: tags.heading, color: c.keyword, fontWeight: "bold" },
    { tag: tags.heading1, color: c.keyword, fontWeight: "bold" },
    { tag: tags.heading2, color: c.keyword, fontWeight: "bold" },
    { tag: tags.heading3, color: c.keyword, fontWeight: "bold" },
    { tag: tags.strong, color: c.foreground, fontWeight: "bold" },
    { tag: tags.emphasis, color: c.foreground, fontStyle: "italic" },
    { tag: tags.link, color: c.type, textDecoration: "underline" },
    { tag: tags.url, color: c.type, textDecoration: "underline" },
    { tag: tags.labelName, color: c.property },
    { tag: tags.namespace, color: c.className },
    { tag: tags.macroName, color: c.function },
    { tag: tags.literal, color: c.string },
    { tag: tags.special(tags.string), color: c.string },
    { tag: tags.regexp, color: c.string },
    { tag: tags.escape, color: c.string },
    { tag: tags.processingInstruction, color: c.keyword },
    { tag: tags.inserted, color: c.string },
    { tag: tags.deleted, color: c.invalid },
    { tag: tags.changed, color: c.property },
    { tag: tags.self, color: c.keyword },
    { tag: tags.derefOperator, color: c.operator },
    { tag: tags.unit, color: c.type },
    { tag: tags.angleBracket, color: c.punctuation },
    { tag: tags.annotation, color: c.property },
    { tag: tags.modifier, color: c.keyword },
    { tag: tags.list, color: c.foreground },
    { tag: tags.quote, color: c.string, fontStyle: "italic" },
    { tag: tags.monospace, color: c.foreground },
    { tag: tags.strikethrough, color: c.invalid, textDecoration: "line-through" },
    { tag: tags.contentSeparator, color: c.operator },
    { tag: tags.special(tags.name), color: c.builtin },
  ]);

  return [theme, syntaxHighlighting(highlightStyle)];
}

function createIdeEditorTheme(EditorView: typeof import("@codemirror/view").EditorView, c: IdeEditorThemeColors): Extension {
  const theme = EditorView.theme(
    {
      "&": {
        backgroundColor: c.background,
        color: c.foreground,
        [EDITOR_SELECTION_BACKGROUND_CSS_VAR]: c.selection,
        [SQL_TABLE_COLOR_CSS_VAR]: c.table,
      },
      ".cm-scroller": {
        backgroundColor: c.background,
      },
      ".cm-content": {
        caretColor: c.cursor,
      },
      ".cm-cursor": {
        borderLeftColor: c.cursor,
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: c.selection,
      },
      ".cm-selectionMatch": {
        backgroundColor: c.selectionMatch,
      },
      ".cm-activeLine": {
        backgroundColor: c.activeLine,
      },
      ".cm-gutters": {
        backgroundColor: c.gutterBackground,
        borderRight: `1px solid ${c.gutterBorder}`,
        color: c.gutterForeground,
      },
      ".cm-activeLineGutter": {
        backgroundColor: c.activeLine,
        color: c.gutterActiveForeground,
      },
      ".cm-matchingBracket": {
        backgroundColor: c.matchingBracket,
        outline: "none",
      },
    },
    { dark: c.dark },
  );

  const highlightStyle = HighlightStyle.define([
    { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.modifier, tags.bool, tags.null], color: c.keyword, ...(c.keywordBold ? { fontWeight: "bold" } : {}) },
    { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape, tags.inserted], color: c.string, ...(c.stringBold ? { fontWeight: "bold" } : {}) },
    { tag: [tags.number, tags.integer, tags.float], color: c.number, ...(c.numberBold ? { fontWeight: "bold" } : {}) },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.quote], color: c.comment, fontStyle: "italic" },
    { tag: [tags.typeName, tags.typeOperator, tags.unit], color: c.type },
    { tag: [tags.name, tags.variableName, tags.definition(tags.variableName)], color: c.variable },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.name), tags.macroName], color: c.function },
    { tag: [SQL_BUILTIN_HIGHLIGHT_TAG, tags.special(tags.name)], color: c.builtin },
    { tag: [tags.propertyName, tags.labelName, tags.annotation], color: c.property },
    { tag: [tags.operator, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator, tags.derefOperator], color: c.operator },
    { tag: [tags.punctuation, tags.separator, tags.paren, tags.brace, tags.bracket, tags.angleBracket], color: c.punctuation },
    { tag: tags.tagName, color: c.tag },
    { tag: tags.attributeName, color: c.attribute },
    { tag: tags.attributeValue, color: c.string },
    { tag: [tags.className, tags.namespace], color: c.className },
    { tag: [tags.meta, tags.processingInstruction], color: c.meta },
    { tag: tags.invalid, color: c.invalid },
    { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3], color: c.keyword, fontWeight: "bold" },
    { tag: tags.strong, color: c.foreground, fontWeight: "bold" },
    { tag: tags.emphasis, color: c.foreground, fontStyle: "italic" },
    { tag: [tags.link, tags.url], color: c.type, textDecoration: "underline" },
    { tag: tags.literal, color: c.string },
    { tag: tags.deleted, color: c.invalid },
    { tag: tags.changed, color: c.property },
    { tag: tags.self, color: c.keyword },
    { tag: tags.list, color: c.foreground },
    { tag: tags.monospace, color: c.foreground },
    { tag: tags.strikethrough, color: c.invalid, textDecoration: "line-through" },
    { tag: tags.contentSeparator, color: c.operator },
  ]);

  return [theme, syntaxHighlighting(highlightStyle)];
}

async function loadIdeEditorTheme(colors: IdeEditorThemeColors): Promise<Extension> {
  return createIdeEditorTheme((await import("@codemirror/view")).EditorView, colors);
}

// ======================================================

const TABLE_ICON: LucideIconNode = [
  ["path", { d: "M12 3v18" }],
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M3 9h18" }],
  ["path", { d: "M3 15h18" }],
];

const COLUMNS_ICON: LucideIconNode = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
  ["path", { d: "M12 3v18" }],
];

const KEYWORD_ICON: LucideIconNode = [
  ["path", { d: "m16 18 6-6-6-6" }],
  ["path", { d: "m8 6-6 6 6 6" }],
];

const SNIPPET_ICON: LucideIconNode = [
  ["path", { d: "M8 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h1" }],
  ["path", { d: "M16 3h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-1" }],
];

const FUNCTION_ICON: LucideIconNode = [
  ["path", { d: "m15 10 5 5-5 5" }],
  ["path", { d: "M4 4v7a4 4 0 0 0 4 4h12" }],
];

const DATABASE_LINK_ICON: LucideIconNode = [
  ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }],
  ["path", { d: "M15 7h2a5 5 0 0 1 0 10h-2" }],
  ["path", { d: "M8 12h8" }],
];

const SCHEMA_ICON: LucideIconNode = [["path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" }]];

function encodeSvgIcon(iconNode: LucideIconNode): string {
  const body = iconNode
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ")} />`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function lucideCompletionIconMask(iconNode: LucideIconNode) {
  const mask = encodeSvgIcon(iconNode);
  return {
    "--dbx-completion-icon-mask": mask,
  };
}

function colorMixValue(fallback: string, preferred: string): string {
  return SUPPORTS_COLOR_MIX ? preferred : fallback;
}

function oklchValue(fallback: string, preferred: string): string {
  return SUPPORTS_OKLCH ? preferred : fallback;
}

export function cellDetailActiveLineColor(): string {
  return colorMixValue("var(--accent)", "color-mix(in oklch, var(--foreground) 4%, transparent)");
}

/** Resolve the concrete CodeMirror theme used by the "Follow app theme" setting. */

/** Load a CodeMirror theme extension by theme name. */
export async function loadEditorTheme(theme: EditorTheme, appAppearance: AppThemeAppearance = "dark", customColors?: CustomThemeColors, appPalette: AppThemePalette = "pearl"): Promise<Extension> {
  const resolvedTheme = resolveEditorTheme(theme, appAppearance, appPalette);
  switch (resolvedTheme) {
    case "one-dark":
      return (await import("@codemirror/theme-one-dark")).oneDark;
    case "vscode-dark":
      return (await import("@uiw/codemirror-theme-vscode")).vscodeDark;
    case "vscode-light":
      return (await import("@uiw/codemirror-theme-vscode")).vscodeLight;
    case "nord":
      return (await import("@uiw/codemirror-theme-nord")).nord;
    case "okaidia":
      return (await import("@uiw/codemirror-theme-okaidia")).okaidia;
    case "material":
      return (await import("@uiw/codemirror-theme-material")).materialDark;
    case "duotone-light":
      return (await import("@uiw/codemirror-theme-duotone")).duotoneLight;
    case "duotone-dark":
      return (await import("@uiw/codemirror-theme-duotone")).duotoneDark;
    case "xcode":
      return (await import("@uiw/codemirror-theme-xcode")).xcodeLight;
    case "xcode-dark":
      return (await import("@uiw/codemirror-theme-xcode")).xcodeDark;
    case "idea-light":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.ideaLight);
    case "idea-dark":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.ideaDark);
    case "jetbrains-light":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.jetbrainsLight);
    case "jetbrains-dark":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.jetbrainsDark);
    case "cursor-light":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.cursorLight);
    case "cursor-dark":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.cursorDark);
    case "claude-light":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.claudeLight);
    case "claude-dark":
      return loadIdeEditorTheme(IDE_EDITOR_THEMES.claudeDark);
    case "custom":
      return createCustomTheme((await import("@codemirror/view")).EditorView, customColors, appAppearance === "dark");
    default:
      return (await import("@codemirror/theme-one-dark")).oneDark;
  }
}

export function buildEditorFontThemeRules(opts?: { fixedHeight?: boolean; scrollable?: boolean }, defaults?: { size?: number; family?: string }): CodeMirrorStyleSpec {
  return {
    "&": {
      ...(opts?.fixedHeight ? { height: "100%" } : {}),
      fontSize: `var(${EDITOR_FONT_SIZE_CSS_VAR}, ${defaults?.size ?? 13}px)`,
    },
    ...(opts?.scrollable ? { ".cm-scroller": { overflowX: "auto", overflowY: "auto" } } : {}),
    ".cm-content": {
      fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, ${defaults?.family ?? "monospace"})`,
      // Ligature fonts (Fira Code, Cascadia Code, JetBrains Mono, ...) combine
      // runs like `--`/`==` into a single shaped glyph. CodeMirror repaints
      // edited lines by patching individual character spans, and that
      // per-keystroke patching can race the browser's ligature reshaping when
      // the same character is typed repeatedly in place, leaving earlier
      // characters unpainted until something else forces a repaint (dbx#7900).
      // Disabling ligatures here avoids the reshaping entirely, matching the
      // same fix already applied to DataGridConditionEditor.vue.
      fontVariantLigatures: "none",
      fontFeatureSettings: '"liga" 0, "calt" 0',
      lineHeight: "1.6",
      padding: "0",
    },
    ".cm-line": {
      padding: "0 2px !important",
    },
    ".cm-selectionLayer .cm-selectionBackground": {
      display: "none",
    },
    // 光标是零宽元素，可见部分只来自 border-left。在 WebView 页面缩放（uiScale）下
    // 1 CSS px 不再映射为整数设备像素，1.2px 的小数边框加上 transform 造成的独立绘制层
    // 会被 WebKit 舍入丢弃，表现为光标在部分列/部分窗口宽度下不显示。
    // 因此：用 margin-top 代替 transform（不产生绘制层），并给边框整数宽度。
    // 颜色仍由各主题的 borderLeftColor 提供，无需改动主题。
    ".cm-cursor": {
      height: "1.6em !important",
      marginTop: "-0.3em",
      borderLeftWidth: "2px",
      marginLeft: "-1px",
    },
    ".cm-trimmedSelection": {
      backgroundColor: `var(${EDITOR_SELECTION_BACKGROUND_CSS_VAR}, rgb(148 163 184 / 38%))`,
      borderRadius: "0",
    },
    ".cm-trimmedSelection-topLeft": {
      borderTopLeftRadius: "3px",
    },
    ".cm-trimmedSelection-topRight": {
      borderTopRightRadius: "3px",
    },
    ".cm-trimmedSelection-bottomLeft": {
      borderBottomLeftRadius: "3px",
    },
    ".cm-trimmedSelection-bottomRight": {
      borderBottomRightRadius: "3px",
    },
    ".cm-gutters": {
      borderRight: "0 !important",
      fontSize: `var(${EDITOR_FONT_SIZE_CSS_VAR}, ${defaults?.size ?? 13}px)`,
      fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, ${defaults?.family ?? "monospace"})`,
      position: "relative",
      userSelect: "none",
    },
    ".cm-gutters:after": {
      background: "rgba(148, 163, 184, 0.38)",
      bottom: "0",
      content: "''",
      pointerEvents: "none",
      position: "absolute",
      right: "0",
      top: "0",
      width: "1px",
      zIndex: "10",
    },
    // Single lines render vertically centered here. Wrapped lines are anchored
    // to the first visual row by createQueryEditorLineNumberAlignmentExtension,
    // which sets an inline `align-items: flex-start` (inline style survives
    // CodeMirror's className rebuild, unlike a toggled class).
    ".cm-lineNumbers .cm-gutterElement": {
      alignItems: "center",
      cursor: "pointer",
      display: "flex",
      justifyContent: "flex-end",
      paddingRight: "8px",
      userSelect: "none",
    },
    ".cm-run-statement-gutter": {
      minWidth: "28px",
    },
    ".cm-run-statement-gutter .cm-gutterElement": {
      alignItems: "center",
      boxSizing: "border-box",
      display: "flex",
      justifyContent: "center",
      minWidth: "28px",
      padding: "0 2px",
    },
    ".cm-run-statement-marker": {
      alignItems: "center",
      background: "transparent",
      border: "1px solid transparent",
      borderRadius: "var(--dbx-radius-fixed-6)",
      boxSizing: "border-box",
      color: "transparent",
      display: "inline-flex",
      flexShrink: "0",
      height: `min(24px, calc(var(${EDITOR_FONT_SIZE_CSS_VAR}, ${defaults?.size ?? 13}px) * 1.6))`,
      justifyContent: "center",
      margin: "0",
      outline: "none",
      padding: "0",
      position: "relative",
      transition: "color 0.15s, background-color 0.15s",
      userSelect: "none",
      verticalAlign: "middle",
      whiteSpace: "nowrap",
      width: `min(24px, calc(var(${EDITOR_FONT_SIZE_CSS_VAR}, ${defaults?.size ?? 13}px) * 1.6))`,
    },
    ".cm-run-statement-marker--active": {
      background: "rgb(16 185 129 / 0.1)",
      color: "rgb(4 120 87)",
      cursor: "pointer",
    },
    ".cm-run-statement-marker--active:hover": {
      background: "rgb(16 185 129 / 0.2)",
      color: "rgb(6 95 70)",
    },
    "&.cm-editor .cm-run-statement-marker > svg": {
      display: "block",
      flexShrink: "0",
      height: "min(14px, 70%)",
      pointerEvents: "none",
      width: "min(14px, 70%)",
    },
    ".cm-statement-execution-badge": {
      alignItems: "center",
      borderRadius: "9999px",
      bottom: "-1px",
      boxShadow: "0 0 0 1px rgb(255 255 255 / 0.9)",
      color: "white",
      display: "inline-flex",
      height: "min(9px, 45%)",
      justifyContent: "center",
      pointerEvents: "none",
      position: "absolute",
      right: "-1px",
      width: "min(9px, 45%)",
    },
    ".cm-statement-execution-badge--success": {
      background: "rgb(5 150 105)",
    },
    ".cm-statement-execution-badge--error": {
      background: "rgb(220 38 38)",
    },
    ".cm-statement-execution-badge svg": {
      display: "block",
      height: "75%",
      width: "75%",
    },
    "&.cm-editor.cm-focused .cm-run-statement-marker:focus-visible": {
      outline: "1px solid var(--ring)",
      outlineOffset: "1px",
    },
    "&.cm-editor .cm-run-statement-marker--executed": {
      background: "rgb(16 185 129 / 0.18)",
      color: "rgb(6 95 70)",
    },
    "&.cm-editor .cm-settings-preview-run-highlight": {
      background: "rgb(16 185 129 / 0.12)",
    },
    ".dark &.cm-editor .cm-run-statement-marker--active": {
      color: "rgb(110 231 183)",
    },
    ".dark &.cm-editor .cm-run-statement-marker--active:hover, .dark &.cm-editor .cm-run-statement-marker--executed": {
      color: "rgb(167 243 208)",
    },
  };
}

/** Build a CodeMirror theme extension for font size + font family. */
export function editorFontTheme(EditorView: typeof import("@codemirror/view").EditorView, size: number, family: string, opts?: { fixedHeight?: boolean; scrollable?: boolean }): Extension {
  return EditorView.theme(buildEditorFontThemeRules(opts, { size, family }));
}

export function buildSqlCompletionThemeRules(): CodeMirrorStyleSpec {
  return {
    ".cm-tooltip.cm-tooltip-autocomplete": {
      background: "var(--popover)",
      backgroundClip: "padding-box",
      border: colorMixValue("1px solid var(--border)", "1px solid color-mix(in oklch, var(--border) 82%, var(--foreground) 18%)"),
      borderRadius: "var(--dbx-radius-md)",
      boxShadow: "0 8px 18px rgb(0 0 0 / 0.14)",
      color: "var(--popover-foreground)",
      fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, var(--font-mono, monospace))`,
      maxWidth: "min(760px, calc(100vw - 24px))",
      minWidth: "min(280px, calc(100vw - 24px))",
      overflowX: "hidden",
      overflowY: "hidden",
      padding: "4px 0",
      scrollbarColor: colorMixValue("var(--muted-foreground) transparent", "color-mix(in oklch, var(--muted-foreground) 44%, transparent) transparent"),
      scrollbarWidth: "thin",
      zIndex: "9999",
    },
    ".cm-tooltip.cm-tooltip-autocomplete *": {
      boxSizing: "border-box",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      maxHeight: "min(280px, calc(100vh - 32px))",
      minWidth: "min(280px, calc(100vw - 24px))",
      maxWidth: "inherit",
      overflowX: "hidden",
      overflowY: "auto",
      padding: "0 4px 0 !important",
      scrollbarColor: colorMixValue("var(--muted-foreground) transparent", "color-mix(in oklch, var(--muted-foreground) 44%, transparent) transparent"),
      scrollbarWidth: "thin",
      width: "max-content",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      alignItems: "center",
      borderRadius: "var(--dbx-radius-sm)",
      color: "var(--popover-foreground)",
      display: "flex",
      fontSize: `clamp(12px, var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px), 14px)`,
      fontWeight: "520",
      height: "28px",
      letterSpacing: "0",
      lineHeight: "28px",
      overflow: "hidden",
      padding: "0 10px !important",
      textOverflow: "clip",
      transition: "background-color 90ms ease, color 90ms ease",
      whiteSpace: "nowrap",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: `${colorMixValue("var(--accent)", "color-mix(in oklch, var(--primary) 14%, var(--popover))")} !important`,
      color: "var(--popover-foreground) !important",
      outline: colorMixValue("1px solid var(--border)", "1px solid color-mix(in oklch, var(--primary) 22%, transparent)"),
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li.cm-batch-column-selection-action": {
      background: "var(--popover)",
      borderRadius: "0",
      borderTop: colorMixValue("1px solid var(--border)", "1px solid color-mix(in oklch, var(--border) 82%, var(--foreground) 18%)"),
      bottom: "0",
      boxShadow: "0 -6px 12px rgb(0 0 0 / 0.06)",
      position: "sticky",
      zIndex: "1",
    },
    ".cm-completionIcon": {
      alignItems: "center",
      display: "inline-flex",
      flex: "0 0 15px",
      height: "15px",
      justifyContent: "center",
      marginRight: "0.65em",
      opacity: "1",
      position: "relative",
      overflow: "hidden",
      width: "15px",
    },
    ".cm-completionIcon:before": {
      backgroundColor: "currentColor",
      content: "''",
      display: "block",
      height: "15px",
      // The pseudo element must be pinned to the icon box: with `left`/`top`
      // left auto, engines disagree on the static position of an absolutely
      // positioned child of a flex container, and WebKit places it far enough
      // left for `overflow: hidden` to cut off half the glyph.
      left: "0",
      top: "0",
      position: "absolute",
      WebkitMaskImage: "var(--dbx-completion-icon-mask)",
      WebkitMaskPosition: "center",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskSize: "14px 14px",
      maskImage: "var(--dbx-completion-icon-mask)",
      maskPosition: "center",
      maskRepeat: "no-repeat",
      maskSize: "14px 14px",
      width: "15px",
    },
    ".cm-completionIcon:after": {
      content: "'none'",
      display: "none",
    },
    ".cm-completionIcon-table": {
      color: colorMixValue("var(--primary)", "color-mix(in oklch, var(--primary) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(TABLE_ICON),
    },
    ".cm-completionIcon-column": {
      color: colorMixValue("var(--blue-500, #3b82f6)", "color-mix(in oklch, var(--blue-500, #3b82f6) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(COLUMNS_ICON),
    },
    ".cm-completionIcon-keyword": {
      color: colorMixValue("var(--orange-500, #f97316)", "color-mix(in oklch, var(--orange-500, #f97316) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(KEYWORD_ICON),
    },
    ".cm-completionIcon-snippet": {
      color: colorMixValue("var(--violet-500, #8b5cf6)", "color-mix(in oklch, var(--violet-500, #8b5cf6) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(SNIPPET_ICON),
    },
    ".cm-completionIcon-function": {
      color: colorMixValue("var(--emerald-500, #10b981)", "color-mix(in oklch, var(--emerald-500, #10b981) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(FUNCTION_ICON),
    },
    ".cm-completionIcon-namespace": {
      color: colorMixValue("var(--sky-500, #0ea5e9)", "color-mix(in oklch, var(--sky-500, #0ea5e9) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(DATABASE_LINK_ICON),
    },
    ".cm-completionIcon-schema": {
      color: colorMixValue("var(--amber-500, #f59e0b)", "color-mix(in oklch, var(--amber-500, #f59e0b) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(SCHEMA_ICON),
    },
    // Reuse the table glyph for aliases instead of CodeMirror's default text
    // icon, which is rendered as a solid black square in some themes.
    ".cm-completionIcon-text": {
      color: colorMixValue("var(--violet-500, #8b5cf6)", "color-mix(in oklch, var(--violet-500, #8b5cf6) 92%, var(--popover-foreground))"),
      ...lucideCompletionIconMask(TABLE_ICON),
    },
    ".cm-completionLabel": {
      color: "inherit",
      flex: "0 1 auto",
      fontFamily: `var(${EDITOR_FONT_FAMILY_CSS_VAR}, var(--font-mono, monospace))`,
      fontSize: `clamp(12px, var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px), 14px)`,
      fontWeight: "520",
      letterSpacing: "0",
      minWidth: "8ch",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-completionMatchedText": {
      color: oklchValue("rgb(29 132 245)", "oklch(0.62 0.19 255)"),
      fontWeight: "700",
      textDecoration: "none",
    },
    ".cm-completionDetail": {
      color: colorMixValue("var(--muted-foreground)", "color-mix(in oklch, var(--popover-foreground) 68%, var(--popover))"),
      fontSize: `clamp(11px, calc(var(${EDITOR_FONT_SIZE_CSS_VAR}, 13px) - 1px), 13px)`,
      fontWeight: "500",
      fontStyle: "normal",
      flex: "1 1 0",
      marginLeft: "10px",
      minWidth: "0",
      opacity: "1",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    ".cm-tooltip.cm-completionInfo": {
      maxWidth: "min(420px, calc(100vw - 24px))",
      overflowWrap: "anywhere",
      zIndex: "10000",
    },
  };
}

export function sqlCompletionTheme(EditorView: typeof import("@codemirror/view").EditorView): Extension {
  return EditorView.theme(buildSqlCompletionThemeRules());
}
