/** Colour themes. Palettes live in styles.css as `[data-theme=…]` blocks; DailyBrief is the default (no attribute). */
export const THEMES = {
  dailybrief: { label: "DailyBrief", dark: true, swatch: ["#0e1116", "#1b212a", "#7c8cff", "#e7eaee"] },
  "catppuccin-mocha": { label: "Catppuccin Mocha", dark: true, swatch: ["#1e1e2e", "#313244", "#cba6f7", "#cdd6f4"] },
  dracula: { label: "Dracula", dark: true, swatch: ["#21222c", "#343746", "#bd93f9", "#f8f8f2"] },
  "catppuccin-latte": { label: "Catppuccin Latte", dark: false, swatch: ["#e6e9ef", "#f7f8fa", "#8839ef", "#4c4f69"] },
  "nord-snow": { label: "Nord Snow Storm", dark: false, swatch: ["#e5e9f0", "#f5f7fa", "#5e81ac", "#2e3440"] },
} as const satisfies Record<string, { label: string; dark: boolean; swatch: readonly string[] }>;

export type ThemeId = keyof typeof THEMES;

const KEY = "theme";
const isTheme = (v: string | null): v is ThemeId => v !== null && v in THEMES;

/** The theme chosen on this device (stored in the browser, so the iPad and desktop can differ). */
export function currentTheme(): ThemeId {
  const stored = localStorage.getItem(KEY);
  return isTheme(stored) ? stored : "dailybrief";
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  if (id === "dailybrief") delete root.dataset.theme;
  else root.dataset.theme = id;
  // Browser chrome (iPad status bar, tab strip) follows the page background.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[id].swatch[0]);
  localStorage.setItem(KEY, id);
}
