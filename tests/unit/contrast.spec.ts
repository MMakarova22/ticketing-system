import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// WCAG 2.1 contrast of the design tokens (apps/web/src/styles/tokens.css), both themes. Text needs 4.5:1; form-control
// borders, the focus ring and state dots (non-text UI) need 3:1. --color-border is decorative and not checked.

const css = readFileSync(fileURLToPath(new URL("../../apps/web/src/styles/tokens.css", import.meta.url)), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    tokens[name!] = value!.toLowerCase();
  }
  return tokens;
}

const light = block(":root");
const themes = { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };

function luminance(hex: string): number {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const UI = 3;

/** [foreground token, background token, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ...["--color-bg", "--color-surface", "--color-surface-2", "--color-surface-hover", "--color-accent-subtle"].flatMap(
    (bg): [string, string, number][] => [
      ["--color-text", bg, TEXT],
      ["--color-text-muted", bg, TEXT],
    ],
  ),
  ["--color-accent", "--color-surface", TEXT],
  ["--color-accent", "--color-bg", TEXT],
  // Text links on hover (base.css).
  ["--color-accent-hover", "--color-surface", TEXT],
  ["--color-accent-hover", "--color-bg", TEXT],
  ["--color-on-accent", "--color-accent", TEXT],
  ["--color-on-accent", "--color-accent-hover", TEXT],
  ["--color-on-danger", "--color-danger", TEXT],
  ["--color-on-danger", "--color-danger-hover", TEXT],
  ["--color-danger", "--color-surface", TEXT], // also .button-danger-subtle text
  ["--color-error-text", "--color-surface", TEXT],
  ["--color-error-text", "--color-error-bg", TEXT],
  ["--color-success-text", "--color-success-bg", TEXT],
  ["--color-warning-text", "--color-warning-bg", TEXT],
  ["--color-info-text", "--color-info-bg", TEXT],
  ["--color-type-bug-text", "--color-type-bug-bg", TEXT],
  ["--color-type-feature-text", "--color-type-feature-bg", TEXT],
  ["--color-type-fix-text", "--color-type-fix-bg", TEXT],
  ["--color-border-strong", "--color-surface", UI],
  ["--color-border-strong", "--color-bg", UI],
  ["--color-focus", "--color-bg", UI],
  ["--color-focus", "--color-surface", UI],
  ["--color-focus", "--color-surface-2", UI],
  ...[
    "--color-state-new",
    "--color-state-ready-for-implementation",
    "--color-state-in-progress",
    "--color-state-ready-for-acceptance",
    "--color-state-done",
  ].map((dot): [string, string, number] => [dot, "--color-surface-2", UI]),
];

for (const [theme, tokens] of Object.entries(themes)) {
  test.describe(`${theme} theme`, () => {
    test("every token used in a pair is defined", () => {
      for (const [fg, bg] of PAIRS) {
        expect(tokens[fg], fg).toMatch(/^#[0-9a-f]{6}$/);
        expect(tokens[bg], bg).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    for (const [fg, bg, min] of PAIRS) {
      test(`${fg} on ${bg} >= ${min}:1`, () => {
        const value = ratio(tokens[fg]!, tokens[bg]!);
        expect(value, `${tokens[fg]} on ${tokens[bg]} = ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
      });
    }
  });
}
