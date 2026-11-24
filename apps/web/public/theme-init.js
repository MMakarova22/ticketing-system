/*
 * Applies the Light/Dark theme before the first paint, so the page never flashes the wrong theme.
 * Loaded as a blocking script from <head> (an external file rather than inline, so it keeps working with a
 * Content-Security-Policy of script-src 'self').
 *
 * Same rules as resolveTheme() in src/lib/theme.ts; keep them in sync (tests/unit/theme.spec.ts runs one table of
 * cases against both): a saved "light"/"dark" under localStorage "tt-theme" wins; otherwise the operating-system
 * setting; if anything fails, light.
 */
(function () {
  var theme = null;
  try {
    var saved = window.localStorage.getItem("tt-theme");
    if (saved === "light" || saved === "dark") {
      theme = saved;
    }
  } catch (error) {
    theme = null;
  }
  if (theme === null) {
    try {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      theme = "light";
    }
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
