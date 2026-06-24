import { useCallback, useState } from "react";

export type Theme = "light" | "dark" | "matrix";
const KEY = "cct.panel.theme";

function current(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "matrix" ? t : "dark";
}

function persist(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable — theme still applies for the session */
  }
}

/** Read/set the theme; `data-theme` on <html> is the source of truth (set
 *  pre-paint by an inline script), persisted to localStorage. `toggle` flips
 *  light/dark; `set` can also reach the hidden `matrix` easter-egg theme. */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
} {
  const [theme, setTheme] = useState<Theme>(current);

  const set = useCallback((t: Theme) => {
    persist(t);
    setTheme(t);
  }, []);

  const toggle = useCallback(() => {
    set(current() === "light" ? "dark" : "light");
  }, [set]);

  return { theme, toggle, set };
}
