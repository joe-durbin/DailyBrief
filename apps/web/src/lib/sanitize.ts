import DOMPurify from "dompurify";

const purify = DOMPurify(window);
let baseUrl = "";

// Runs for every element: resolve relative links/images against the article's own URL, open links in a new tab.
purify.addHook("afterSanitizeAttributes", (node) => {
  for (const attr of ["href", "src"] as const) {
    const value = node.getAttribute(attr);
    if (!value) continue;
    try {
      const abs = new URL(value, baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") node.setAttribute(attr, abs.toString());
      else node.removeAttribute(attr);
    } catch {
      node.removeAttribute(attr);
    }
  }
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
});

/** Sanitise untrusted article HTML (RSS / extracted pages) for rendering in the reader. */
export function sanitizeArticleHtml(html: string, articleUrl: string): string {
  baseUrl = articleUrl;
  return purify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "frame", "form", "input", "button", "textarea", "select", "object", "embed", "svg", "math", "link", "meta", "base"],
    FORBID_ATTR: ["style", "class", "id", "srcset", "sizes", "width", "height"],
    ALLOW_DATA_ATTR: false,
  });
}
