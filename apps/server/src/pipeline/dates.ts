/**
 * Publication dates from wherever a page exposes them: metadata, structured data or the URL. Many sources only give a
 * month (journal "2026/7", arXiv ids), which is still enough to tell a 200-day-old paper from today's news.
 */
export type DateHint = { at: Date; precision: "day" | "month" };

const ISO_DAY = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/;
const ISO_MONTH = /^(\d{4})[-/.](\d{1,2})$/;

function make(y: number, m: number, d: number | null): DateHint | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || (d !== null && (d < 1 || d > 31))) return null;
  const at = new Date(Date.UTC(y, m - 1, d ?? 1, 12));
  return at.getTime() > Date.now() + 2 * 86_400_000 ? null : { at, precision: d === null ? "month" : "day" };
}

/** "2026-10-03", "2026/10/03", ISO timestamps, "2026/7", or anything `Date` understands with a day in it. */
export function parseLooseDate(raw: string | null | undefined): DateHint | null {
  const s = raw?.trim();
  if (!s) return null;
  const day = ISO_DAY.exec(s);
  if (day) {
    // Full timestamps keep their time zone; bare dates are taken as midday UTC.
    const t = s.length > 10 ? new Date(s) : null;
    if (t && !Number.isNaN(t.getTime()) && t.getTime() <= Date.now() + 2 * 86_400_000) return { at: t, precision: "day" };
    return make(Number(day[1]), Number(day[2]), Number(day[3]));
  }
  const month = ISO_MONTH.exec(s);
  if (month) return make(Number(month[1]), Number(month[2]), null);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) || !/\d{1,2}/.test(s.replace(/\d{4}/, "")) ? null : make(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Metadata names that carry the publication date, most specific first. */
const META_KEYS = [
  "article:published_time",
  "og:published_time",
  "citation_publication_date",
  "citation_online_date",
  "citation_date",
  "dc.date.issued",
  "dc.date",
  "dcterms.issued",
  "dcterms.created",
  "prism.publicationdate",
  "parsely-pub-date",
  "sailthru.date",
  "pubdate",
  "publishdate",
  "date",
];

type El = { getAttribute(name: string): string | null; textContent: string | null };
/** The parts of a (linkedom) document this needs. */
type Doc = { querySelectorAll(selector: string): Iterable<El>; querySelector(selector: string): El | null };

/** The page's own publication date from <meta>, JSON-LD `datePublished` or `<time itemprop=datePublished>`. */
export function pageDate(document: Doc): DateHint | null {
  const meta = new Map<string, string>();
  for (const el of document.querySelectorAll("meta[content]")) {
    const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? el.getAttribute("itemprop") ?? "").toLowerCase();
    const content = el.getAttribute("content");
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const candidates = [...META_KEYS.map((k) => meta.get(k)), meta.get("datepublished")];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    candidates.push(/"datePublished"\s*:\s*"([^"]+)"/.exec(script.textContent ?? "")?.[1]);
  }
  candidates.push(document.querySelector("time[itemprop=datePublished], time[pubdate]")?.getAttribute("datetime") ?? undefined);
  return bestDate(candidates.map(parseLooseDate));
}

/** Dates in URLs: /2026/10/07/, 2026-10-07, /2026/10/ (month) and arXiv ids (YYMM.NNNNN, month). */
export function urlDate(url: string): DateHint | null {
  let path: string;
  try {
    const u = new URL(url);
    if (/(^|\.)arxiv\.org$/.test(u.hostname)) {
      const id = /\/(?:abs|html|pdf)\/(\d{2})(\d{2})\.\d{4,5}/.exec(u.pathname);
      if (id) return make(2000 + Number(id[1]), Number(id[2]), null);
    }
    path = u.pathname;
  } catch {
    return null;
  }
  const day = /(?:^|\/|[-_])(20\d{2})[/-](\d{2})[/-](\d{2})(?=$|[/_.-])/.exec(path);
  if (day) return make(Number(day[1]), Number(day[2]), Number(day[3]));
  const month = /\/(20\d{2})\/(\d{2})\//.exec(path);
  return month ? make(Number(month[1]), Number(month[2]), null) : null;
}

/** The first day-precise date, else the first month-precise one. */
export function bestDate(hints: (DateHint | null | undefined)[]): DateHint | null {
  return hints.find((h) => h?.precision === "day") ?? hints.find((h) => h?.precision === "month") ?? null;
}

/** The latest moment a date could mean: the end of its month when only the month is known. */
export function latestPossible(h: DateHint): Date {
  return h.precision === "day" ? h.at : new Date(Date.UTC(h.at.getUTCFullYear(), h.at.getUTCMonth() + 1, 1) - 1);
}

/** "2026-10-03", or "2026-07 (month only)". */
export function formatHint(h: DateHint | null): string {
  if (!h) return "unknown";
  const iso = h.at.toISOString();
  return h.precision === "day" ? iso.slice(0, 10) : `${iso.slice(0, 7)} (month only)`;
}
