const TRACKING_PARAMS = /^(utm_|mc_|fbclid$|gclid$|ref$|ref_src$|cmpid$|ocid$|_hs|mkt_tok$|s_cid$)/i;

/** Normalise a URL so the same article reached via different routes compares equal. */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.|amp\.)/, "");
  url.protocol = "https:";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "") || "/";
  return url.toString();
}

const CVE = /\bCVE-\d{4}-\d{4,7}\b/gi;
export function cveIds(text: string): string[] {
  return [...new Set((text.match(CVE) ?? []).map((c) => c.toUpperCase()))];
}

const STOPWORDS = new Set(
  "a an and are as at be by for from has have how in into is it its new of on or over the their this to via vs was what when who why with after about now more than security flaw vulnerability attack attacks researchers report".split(" "),
);

function titleTerms(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

type PreClusterInput = { title: string; text: string };

const TITLE_SIMILARITY = 0.45;

/**
 * Cheap first-pass grouping before the LLM: candidates whose titles overlap strongly or that share a CVE ID
 * are assumed to be the same story. Returns a group index per input (same index = same group).
 */
export function preCluster(items: PreClusterInput[]): number[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i] ?? i] ?? i;
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const terms = items.map((it) => titleTerms(it.title));
  const cves = items.map((it) => new Set(cveIds(`${it.title} ${it.text.slice(0, 3000)}`)));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const ti = terms[i];
      const tj = terms[j];
      const ci = cves[i];
      const cj = cves[j];
      if (!ti || !tj || !ci || !cj) continue;
      const sharedCve = [...ci].some((c) => cj.has(c));
      if (sharedCve || jaccard(ti, tj) >= TITLE_SIMILARITY) union(i, j);
    }
  }
  return items.map((_, i) => find(i));
}
