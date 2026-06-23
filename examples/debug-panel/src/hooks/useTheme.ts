import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const STORAGE_KEY = "wcd-theme";

/**
 * Theme hook — dark default, follows `prefers-color-scheme` on first load,
 * then persists the user's choice in localStorage. Sets `data-theme` on
 * `<html>` so the CSS variable overrides take effect.
 */
export function useTheme(): { value: Theme; toggle: () => void } {
  const [value, setValue] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch {
      /* SSR / no-storage — fall through */
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  }, [value]);

  return { value, toggle: () => setValue((v) => (v === "dark" ? "light" : "dark")) };
}
