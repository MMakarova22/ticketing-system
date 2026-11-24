import { useTheme } from "../../lib/theme.ts";
import { MoonIcon, SunIcon } from "../icons.tsx";

/**
 * Light/Dark switch (top navigation and public pages). The first click saves an explicit choice; until then the
 * operating-system setting is followed (see src/lib/theme.ts).
 *
 * Icon = current theme (sun in light, moon in dark). Accessible name is fixed ("Dark theme"); aria-pressed is true
 * while the dark theme is on, so the state is announced without the name changing. The tooltip (title) shows the
 * action for sighted mouse users.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className ? `icon-button ${className}` : "icon-button"}
      onClick={toggleTheme}
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      data-testid="theme-toggle"
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
