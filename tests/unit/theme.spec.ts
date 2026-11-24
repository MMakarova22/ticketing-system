import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  applyTheme,
  type ColorSchemeQuery,
  currentPreferredTheme,
  followSystemTheme,
  getAppliedTheme,
  parseTheme,
  readStoredTheme,
  resolveTheme,
  setTheme,
  THEME_STORAGE_KEY,
  type ThemeEnvironment,
  toggleTheme,
  writeStoredTheme,
} from "../../apps/web/src/lib/theme.ts";

// Theme infrastructure (UI redesign step 1). The browser code reads localStorage and matchMedia; here both are fakes,
// including storage that throws (private mode, blocked site data, full quota).

interface FakeOptions {
  stored?: string | null;
  systemDark?: boolean;
  /** "none" = storage unavailable; "get" / "set" / "both" = those calls throw. */
  storageFailure?: "none" | "get" | "set" | "both";
  /** false = no matchMedia; "throws" = matchMedia throws. */
  matchMedia?: boolean | "throws";
}

function fakeEnvironment(options: FakeOptions = {}) {
  const values = new Map<string, string>();
  if (options.stored !== undefined && options.stored !== null) {
    values.set(THEME_STORAGE_KEY, options.stored);
  }
  const failure = options.storageFailure;
  const storage =
    failure === "none"
      ? null
      : {
          getItem: (key: string) => {
            if (failure === "get" || failure === "both") throw new Error("SecurityError: storage blocked");
            return values.get(key) ?? null;
          },
          setItem: (key: string, value: string) => {
            if (failure === "set" || failure === "both") throw new Error("QuotaExceededError");
            values.set(key, value);
          },
        };
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = { dark: options.systemDark ?? false };
  const query: ColorSchemeQuery = {
    get matches() {
      return media.dark;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const env: ThemeEnvironment = {
    storage,
    root: { dataset: {} },
    matchMedia:
      options.matchMedia === false
        ? null
        : (q: string) => {
            if (options.matchMedia === "throws") throw new Error("matchMedia failed");
            expect(q).toBe("(prefers-color-scheme: dark)");
            return query;
          },
  };
  /** Simulates the operating system switching light/dark. */
  const setSystemDark = (dark: boolean) => {
    media.dark = dark;
    for (const listener of [...listeners]) listener({ matches: dark });
  };
  return { env, values, listeners, setSystemDark };
}

/** Runs public/theme-init.js in a sandbox with the same fakes; returns the data-theme it sets. */
function runThemeInit(options: FakeOptions): string | undefined {
  const source = readFileSync(fileURLToPath(new URL("../../apps/web/public/theme-init.js", import.meta.url)), "utf8");
  const { env } = fakeEnvironment(options);
  const attributes: Record<string, string> = {};
  const window: Record<string, unknown> = {};
  Object.defineProperty(window, "localStorage", {
    get() {
      if (options.storageFailure === "none") throw new Error("SecurityError: localStorage is not available");
      return env.storage;
    },
  });
  if (env.matchMedia) window.matchMedia = env.matchMedia;
  const document = { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } };
  runInNewContext(source, { window, document });
  return attributes["data-theme"];
}

/** [description, options, expected theme] — run against both theme.ts and public/theme-init.js. */
const CASES: [string, FakeOptions, "light" | "dark"][] = [
  ["saved dark, system light", { stored: "dark", systemDark: false }, "dark"],
  ["saved light, system dark", { stored: "light", systemDark: true }, "light"],
  ["nothing saved, system dark", { systemDark: true }, "dark"],
  ["nothing saved, system light", { systemDark: false }, "light"],
  ["invalid saved value 'blue', system dark", { stored: "blue", systemDark: true }, "dark"],
  ["invalid saved value 'DARK' (case matters), system light", { stored: "DARK", systemDark: false }, "light"],
  ["empty saved value, system dark", { stored: "", systemDark: true }, "dark"],
  ["saved value with spaces ' dark', system light", { stored: " dark", systemDark: false }, "light"],
  ["storage unavailable, system dark", { storageFailure: "none", systemDark: true }, "dark"],
  ["storage read throws, saved dark ignored, system light", { stored: "dark", storageFailure: "get", systemDark: false }, "light"],
  ["no matchMedia, nothing saved", { matchMedia: false }, "light"],
  ["matchMedia throws, nothing saved", { matchMedia: "throws" }, "light"],
  ["matchMedia throws, saved dark", { stored: "dark", matchMedia: "throws" }, "dark"],
];

test.describe("theme resolution", () => {
  test("parseTheme accepts exactly 'light' and 'dark'", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    for (const invalid of [null, undefined, "", "Light", "DARK", " dark", "system", "auto", 1, {}]) {
      expect(parseTheme(invalid), String(invalid)).toBeNull();
    }
  });

  test("resolveTheme: a saved choice wins, otherwise the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  for (const [description, options, expected] of CASES) {
    test(`same result in theme.ts and theme-init.js: ${description} -> ${expected}`, () => {
      expect(currentPreferredTheme(fakeEnvironment(options).env)).toBe(expected);
      expect(runThemeInit(options)).toBe(expected);
    });
  }
});

test.describe("theme storage", () => {
  test("setTheme saves and applies the choice", () => {
    const { env, values } = fakeEnvironment({ systemDark: false });
    setTheme("dark", env);
    expect(values.get("tt-theme")).toBe("dark");
    expect(env.root.dataset.theme).toBe("dark");
    expect(readStoredTheme(env)).toBe("dark");
  });

  test("storage failures never throw; the theme still applies for the page", () => {
    for (const storageFailure of ["none", "set", "both"] as const) {
      const { env } = fakeEnvironment({ storageFailure });
      expect(writeStoredTheme("dark", env), storageFailure).toBe(false);
      expect(() => setTheme("dark", env), storageFailure).not.toThrow();
      expect(getAppliedTheme(env), storageFailure).toBe("dark");
    }
    const { env } = fakeEnvironment({ stored: "dark", storageFailure: "get" });
    expect(readStoredTheme(env)).toBeNull();
  });

  test("toggleTheme switches between light and dark and saves the result", () => {
    const { env, values } = fakeEnvironment();
    applyTheme("light", env);
    expect(toggleTheme(env)).toBe("dark");
    expect(values.get("tt-theme")).toBe("dark");
    expect(toggleTheme(env)).toBe("light");
    expect(env.root.dataset.theme).toBe("light");
    expect(values.get("tt-theme")).toBe("light");
  });

  test("getAppliedTheme falls back to light for a missing or invalid attribute", () => {
    const { env } = fakeEnvironment();
    expect(getAppliedTheme(env)).toBe("light");
    env.root.dataset.theme = "purple";
    expect(getAppliedTheme(env)).toBe("light");
  });
});

test.describe("following the operating-system setting", () => {
  test("without a saved choice, system changes are applied live", () => {
    const { env, setSystemDark } = fakeEnvironment({ systemDark: false });
    applyTheme(currentPreferredTheme(env), env);
    const stop = followSystemTheme(env);
    setSystemDark(true);
    expect(env.root.dataset.theme).toBe("dark");
    setSystemDark(false);
    expect(env.root.dataset.theme).toBe("light");
    stop();
  });

  test("a saved choice stops the following; stop() removes the listener", () => {
    const { env, setSystemDark, listeners } = fakeEnvironment({ systemDark: false });
    const stop = followSystemTheme(env);
    setTheme("light", env);
    setSystemDark(true);
    expect(env.root.dataset.theme).toBe("light"); // the explicit choice wins
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  test("no matchMedia or a throwing matchMedia: following is a safe no-op", () => {
    for (const matchMedia of [false, "throws"] as const) {
      const { env } = fakeEnvironment({ matchMedia });
      const stop = followSystemTheme(env);
      expect(() => stop()).not.toThrow();
    }
  });
});
