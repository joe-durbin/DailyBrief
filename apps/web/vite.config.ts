import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** The app version lives in the root package.json (see CHANGELOG.md); the manual's data-version spans must match it. */
const VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const MANUAL = new URL("../../README.html", import.meta.url);
const STYLES = new URL("./src/styles.css", import.meta.url);

/** Applies the theme chosen in the app (lib/theme.ts stores it under "theme") before the manual paints. */
const MANUAL_THEME_JS = `try { var t = localStorage.getItem("theme"); if (t && t !== "dailybrief") document.documentElement.dataset.theme = t; } catch (e) {}\n`;

/**
 * Serves the user manual (repo-root README.html) as /manual.html for the in-app help dialog, with the app's
 * alternative theme palettes (the `[data-theme=…]` blocks of styles.css) copied in, so themes are defined once.
 * The build fails if the version printed in the manual differs from package.json.
 */
function manual(): Plugin {
  const load = () => {
    const html = readFileSync(MANUAL, "utf8");
    const stale = [...html.matchAll(/<span data-version>([^<]*)<\/span>/g)].map((m) => m[1]).filter((v) => v !== VERSION);
    if (stale.length) throw new Error(`README.html shows version ${stale[0]} but package.json is ${VERSION} — update the manual`);
    const themes = readFileSync(STYLES, "utf8").match(/\[data-theme="[^"]+"\]\s*\{[^}]*\}/g) ?? [];
    if (!themes.length || !html.includes("/* @themes */")) throw new Error("Manual theming: no [data-theme] blocks in styles.css or no /* @themes */ marker in README.html");
    return html.replace("/* @themes */", themes.join("\n  "));
  };
  return {
    name: "dailybrief-manual",
    configureServer(server) {
      server.middlewares.use("/manual.html", (_req, res) => {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(load());
      });
      server.middlewares.use("/manual-theme.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        res.end(MANUAL_THEME_JS);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manual.html", source: load() });
      this.emitFile({ type: "asset", fileName: "manual-theme.js", source: MANUAL_THEME_JS });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), manual()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8080", "/healthz": "http://127.0.0.1:8080" },
  },
});
