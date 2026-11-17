export const THEME_COOKIE = "pti-theme";
export type ThemePref = "light" | "dark" | "system";

export function parseTheme(v: string | undefined): ThemePref {
  return v === "light" || v === "dark" ? v : "system";
}
