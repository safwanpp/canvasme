"use client";

import { useLayoutEffect } from "react";
import { getResolvedTheme, subscribeTheme } from "@/lib/theme";
import { THEME_COLOR } from "@/lib/themeScript";

function apply() {
  const dark = getResolvedTheme() === "dark";
  const root = document.documentElement;
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  root.style.colorScheme = dark ? "dark" : "light";
  setThemeColor(dark ? THEME_COLOR.dark : THEME_COLOR.light);
}

function setThemeColor(color: string) {
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
}

/**
 * Applies the theme to <html> while an /app route is mounted and removes it on the way out, so
 * the marketing pages always render light. The inline script in the layout covers first paint.
 * The effect reads the real stored values itself (not a hydration snapshot), so it never
 * downgrades the attribute the inline script set.
 */
export function ThemeScope() {
  useLayoutEffect(() => {
    apply();
    const off = subscribeTheme(apply);
    return () => {
      off();
      const root = document.documentElement;
      root.removeAttribute("data-theme");
      root.style.colorScheme = "";
      setThemeColor(THEME_COLOR.light);
    };
  }, []);
  return null;
}
