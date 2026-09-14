import { computed } from "vue";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTheme } from "@/composables/useTheme";
import { editorThemeAppearanceFor } from "@/lib/editor/editorThemePalette";
import { createMonacoTheme } from "@/lib/editor/monaco/monacoTheme";

export function useMonacoAppearance() {
  const settingsStore = useSettingsStore();
  const { isDark, themePalette, activeCustomUiColors } = useTheme();
  const theme = computed(() => {
    const settings = settingsStore.editorSettings;
    const customTheme = settings.customThemes?.find((candidate) => candidate.id === settings.activeCustomThemeId) ?? settings.customThemes?.[0];
    const colors = settings.theme === "custom" ? (customTheme?.colors ?? settings.customThemeColors) : settings.customThemeColors;
    const appearance = editorThemeAppearanceFor(isDark.value ? "dark" : "light", themePalette.value, activeCustomUiColors.value);
    return createMonacoTheme(settings.theme, appearance, themePalette.value, colors);
  });
  const options = computed(() => ({
    fontSize: settingsStore.editorSettings.fontSize,
    fontFamily: settingsStore.editorSettings.fontFamily,
    wordWrap: settingsStore.editorSettings.wordWrap ? ("on" as const) : ("off" as const),
    autoClosingBrackets: settingsStore.editorSettings.autoCloseBrackets ? ("languageDefined" as const) : ("never" as const),
    autoClosingQuotes: settingsStore.editorSettings.autoCloseBrackets ? ("languageDefined" as const) : ("never" as const),
  }));
  return { theme, options };
}
