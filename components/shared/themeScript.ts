// Phase 6J-3B — the pre-paint theme script shared by the Museum and Studio shells.
// Dark is the default (tokens.css :root); this only CORRECTS that, synchronously and
// before content paints, for a returning visitor who chose light (so there is no flash).
// The preference key is shared with ThemeToggle, so the choice carries between the
// public site and Studio.

export const THEME_STORAGE_KEY = "musicmadras-theme";

export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    if (stored === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (e) {}
})();
`;