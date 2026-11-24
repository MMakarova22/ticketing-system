import { useCallback, useSyncExternalStore } from "react";

/**
 * Light/Dark theme (UI redesign step 1).
 *
 * - The theme is the `data-theme` attribute on <html>; CSS tokens (src/styles/tokens.css) follow it.
 * - public/theme-init.js applies it before first paint with the same rules as `resolveTheme` (keep them in sync;
 *   tests/unit/theme.spec.ts runs one table of cases against both).
 * - A saved choice lives in localStorage under THEME_STORAGE_KEY. Without one, the operating-system setting is used and
 *   followed live (`followSystemTheme`).
 * - Storage can be unavailable (private mode, blocked site data, quota): every access is guarded, and the app then
 *   simply does not remember the choice.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "tt-theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** The subset of Storage used here. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The subset of MediaQueryList used here. */
export interface ColorSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

/** Everything the theme code touches; injectable so it can be unit-tested without a browser. */
export interface ThemeEnvironment {
  storage: ThemeStorage | null;
  root: { dataset: Record<string, string | undefined> };
  matchMedia: ((query: string) => ColorSchemeQuery) | null;
}

/** The real browser environment. Reading `window.localStorage` itself can throw (SecurityError), hence the guard. */
export function browserEnvironment(): ThemeEnvironment {
  let storage: ThemeStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    root: document.documentElement,
    matchMedia: typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : null,
  };
}

/** "light" or "dark", exactly; anything else (missing, empty, other case, garbage) is not a valid choice. */
export function parseTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** A saved choice wins; otherwise the operating-system setting. */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  return stored ?? (systemPrefersDark ? "dark" : "light");
}

export function readStoredTheme(env: ThemeEnvironment = browserEnvironment()): Theme | null {
  try {
    return parseTheme(env.storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Saves the choice; returns false when storage is unavailable or full (the theme still applies for this page). */
export function writeStoredTheme(theme: Theme, env: ThemeEnvironment = browserEnvironment()): boolean {
  if (!env.storage) {
    return false;
  }
  try {
    env.storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function systemPrefersDark(env: ThemeEnvironment = browserEnvironment()): boolean {
  try {
    return env.matchMedia?.(DARK_SCHEME_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/** The theme currently on <html>; "light" if the attribute is missing or invalid. */
export function getAppliedTheme(env: ThemeEnvironment = browserEnvironment()): Theme {
  return parseTheme(env.root.dataset.theme) ?? "light";
}

export function applyTheme(theme: Theme, env: ThemeEnvironment = browserEnvironment()): void {
  env.root.dataset.theme = theme;
}

/** The theme to use right now (same rules as public/theme-init.js). */
export function currentPreferredTheme(env: ThemeEnvironment = browserEnvironment()): Theme {
  return resolveTheme(readStoredTheme(env), systemPrefersDark(env));
}

/** Applies and saves an explicit choice. From then on the operating-system setting is no longer followed. */
export function setTheme(theme: Theme, env: ThemeEnvironment = browserEnvironment()): void {
  writeStoredTheme(theme, env);
  applyTheme(theme, env);
}

export function toggleTheme(env: ThemeEnvironment = browserEnvironment()): Theme {
  const next: Theme = getAppliedTheme(env) === "dark" ? "light" : "dark";
  setTheme(next, env);
  return next;
}

/**
 * While no choice is saved, applies the operating-system setting whenever it changes. Returns a function that stops
 * listening. A no-op when matchMedia is unavailable.
 */
export function followSystemTheme(env: ThemeEnvironment = browserEnvironment()): () => void {
  let query: ColorSchemeQuery | undefined;
  try {
    query = env.matchMedia?.(DARK_SCHEME_QUERY);
  } catch {
    query = undefined;
  }
  if (!query) {
    return () => {};
  }
  const listener = (event: { matches: boolean }) => {
    if (readStoredTheme(env) === null) {
      applyTheme(resolveTheme(null, event.matches), env);
    }
  };
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Notifies `onChange` when <html data-theme> changes (any source: toggle, system change, another hook). */
function subscribeToAppliedTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readAppliedTheme(): Theme {
  return getAppliedTheme();
}

/** React access to the theme. Re-renders whenever the applied theme changes, wherever the change came from. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribeToAppliedTheme, readAppliedTheme, () => "light" as const);
  const set = useCallback((next: Theme) => setTheme(next), []);
  const toggle = useCallback(() => {
    toggleTheme();
  }, []);
  return { theme, setTheme: set, toggleTheme: toggle };
}
