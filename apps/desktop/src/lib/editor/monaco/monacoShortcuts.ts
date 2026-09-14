import { isMacShortcutPlatform, parseShortcutStrokes } from "@/lib/editor/shortcutDisplay";
import type { Monaco } from "./monaco";

export function shortcutToMonacoKeybinding(monaco: Monaco, shortcut: string, platform = globalThis.navigator?.platform ?? ""): number | undefined {
  const strokes = parseShortcutStrokes(shortcut);
  if (!strokes.length || strokes.length > 2) return undefined;
  const aliases: Record<string, string> = {
    Return: "Enter",
    Esc: "Escape",
    ArrowUp: "UpArrow",
    ArrowDown: "DownArrow",
    ArrowLeft: "LeftArrow",
    ArrowRight: "RightArrow",
    " ": "Space",
    Spacebar: "Space",
    Plus: "Equal",
    "+": "Equal",
    "-": "Minus",
    "=": "Equal",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    "[": "BracketLeft",
    "]": "BracketRight",
    "`": "Backquote",
  };
  const keys: number[] = [];
  for (const parts of strokes) {
    const key = parts[parts.length - 1];
    const name = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : (aliases[key] ?? key);
    const code = monaco.KeyCode[name as keyof typeof monaco.KeyCode];
    if (typeof code !== "number") return undefined;
    let binding = code;
    for (const modifier of parts.slice(0, -1)) {
      if (modifier === "Mod") binding |= monaco.KeyMod.CtrlCmd;
      else if (modifier === "Ctrl" || modifier === "Control") binding |= isMacShortcutPlatform(platform) ? monaco.KeyMod.WinCtrl : monaco.KeyMod.CtrlCmd;
      else if (modifier === "Meta" || modifier === "Cmd") binding |= isMacShortcutPlatform(platform) ? monaco.KeyMod.CtrlCmd : monaco.KeyMod.WinCtrl;
      else if (modifier === "Shift") binding |= monaco.KeyMod.Shift;
      else if (modifier === "Alt") binding |= monaco.KeyMod.Alt;
      else return undefined;
    }
    if (key === "Plus" || key === "+") binding |= monaco.KeyMod.Shift;
    keys.push(binding);
  }
  return keys.length === 1 ? keys[0] : monaco.KeyMod.chord(keys[0], keys[1]);
}
