import { describe, expect, it } from "vitest";
import type { Monaco } from "../monaco";
import { shortcutToMonacoKeybinding } from "../monacoShortcuts";

const runtime = {
  KeyMod: { CtrlCmd: 2048, WinCtrl: 256, Alt: 512, Shift: 1024, chord: (first: number, second: number) => first | (second << 16) },
  KeyCode: { KeyK: 41, KeyC: 33, Space: 10, Enter: 3, Equal: 81, Slash: 85, Period: 84, F8: 66, Digit1: 22 },
} as unknown as Monaco;

describe("Monaco shortcut mapping", () => {
  it("maps platform-neutral and physical control/meta modifiers separately", () => {
    expect(shortcutToMonacoKeybinding(runtime, "Mod+K", "MacIntel")).toBe(2048 | 41);
    expect(shortcutToMonacoKeybinding(runtime, "Ctrl+K", "MacIntel")).toBe(256 | 41);
    expect(shortcutToMonacoKeybinding(runtime, "Meta+K", "Linux")).toBe(256 | 41);
    expect(shortcutToMonacoKeybinding(runtime, "Ctrl+K", "Linux")).toBe(2048 | 41);
  });
  it("supports DBX punctuation, digits, function keys and plus", () => {
    expect(shortcutToMonacoKeybinding(runtime, "Alt+/", "MacIntel")).toBe(512 | 85);
    expect(shortcutToMonacoKeybinding(runtime, "Mod++", "MacIntel")).toBe(2048 | 1024 | 81);
    expect(shortcutToMonacoKeybinding(runtime, "Ctrl+Space", "Linux")).toBe(2048 | 10);
    expect(shortcutToMonacoKeybinding(runtime, "F8", "Linux")).toBe(66);
    expect(shortcutToMonacoKeybinding(runtime, "Alt+1", "Linux")).toBe(512 | 22);
  });
  it("retains two-stroke chords and rejects unsupported strokes", () => {
    expect(shortcutToMonacoKeybinding(runtime, "Mod+K Mod+C", "Linux")).toBe(runtime.KeyMod.chord(2048 | 41, 2048 | 33));
    expect(shortcutToMonacoKeybinding(runtime, "Mod+K Mod+C Mod+K", "Linux")).toBeUndefined();
    expect(shortcutToMonacoKeybinding(runtime, "", "Linux")).toBeUndefined();
    expect(shortcutToMonacoKeybinding(runtime, "Hyper+K", "Linux")).toBeUndefined();
  });
});
