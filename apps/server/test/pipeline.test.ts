import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { canonicalUrl, preCluster } from "../src/pipeline/candidates.ts";
import { isBlockedAddress, safeFetch } from "../src/net/safe-fetch.ts";
import { feedBody, isFeedDocument, parseFeed } from "../src/pipeline/feeds.ts";
import { formatHint, latestPossible, pageDate, urlDate } from "../src/pipeline/dates.ts";
import { parseHTML } from "linkedom";
import { AiError } from "../src/llm/errors.ts";
import type { LlmRouter } from "../src/llm/router.ts";
import { balancedEvidence, deepEvidence, deepShortlist, deepSummaries } from "../src/pipeline/research-depth.ts";

describe("safeFetch SSRF guard", () => {
  it("classifies internal and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
  });

  it("refuses internal targets, including via hostname resolution", async () => {
    const server = createServer((_, res) => res.end("internal secret")).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as { port: number };
    try {
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`), /Blocked/);
      await assert.rejects(safeFetch(`http://localhost:${port}/`), /Blocked/);
      await assert.rejects(safeFetch(`http://host.docker.internal:4000/v1/models`), /Blocked/);
      await assert.rejects(safeFetch("file:///etc/passwd"), /Unsupported protocol/);
    } finally {
      server.close();
    }
  });
});

describe("candidate dedupe", () => {
  it("canonicalises tracking params, www and trailing slashes", () => {
    assert.equal(
      canonicalUrl("http://www.Example.com/post/?utm_source=x&b=2&a=1#top"),
      canonicalUrl("https://example.com/post?a=1&b=2"),
    );
  });

  it("collapses three write-ups of one story and keeps unrelated stories apart", () => {
    const groups = preCluster([
      { title: "Critical RCE in Acme Gateway actively exploited", text: "Acme disclosed CVE-2026-41234 affecting Gateway 9." },
      { title: "Acme patches Gateway flaw after attacks", text: "The bug, tracked as CVE-2026-41234, allows remote code execution." },
      { title: "Hackers exploit Acme Gateway remote code execution bug", text: "Researchers saw mass scanning for CVE-2026-41234." },
      { title: "New prompt injection technique bypasses agent guardrails", text: "A research team showed encrypted payloads evade filters." },
      { title: "AWS IAM Identity Center adds new session controls", text: "AWS announced changes to session duration." },
    ]);
    assert.equal(new Set(groups.slice(0, 3)).size, 1, "the three Acme write-ups form one group");
    assert.equal(new Set(groups).size, 3, "the two unrelated stories stay separate");
  });
});

describe("feed parsing", () => {
  const item = (n: number) => `<item><title>Post ${n}</title><link>https://b.example/${n}</link><pubDate>Mon, 0${n} Oct 2026 10:00:00 GMT</pubDate></item>`;

  it("treats an HTML page as no items instead of failing, so the page's feed link can be followed", () => {
    const deep = `<!doctype html><html><body>${"<div>".repeat(5_000)}x${"</div>".repeat(5_000)}</body></html>`;
    assert.deepEqual(parseFeed(deep), []);
  });

  it("recognises feeds after declarations and comments, and rejects comment-heavy HTML quickly", () => {
    assert.equal(isFeedDocument(`\uFEFF<?xml version="1.0"?>\n<!-- generated -->\n<?xml-stylesheet href="s.xsl"?>\n<rss version="2.0">`), true);
    assert.equal(isFeedDocument(`<feed xmlns="http://www.w3.org/2005/Atom">`), true);
    // Froze the server with the old regex: many comments before an HTML root.
    const page = `${"<!-- section -->\n".repeat(40)}<!doctype html><html><body>${"x".repeat(1_000)}</body></html>`;
    const started = performance.now();
    assert.equal(isFeedDocument(page), false);
    assert.ok(performance.now() - started < 50, "linear time");
  });

  it("keeps the complete items of a feed cut off at the size cap", () => {
    const full = `<?xml version="1.0"?><rss><channel><title>B</title>${item(1)}${item(2)}${item(3)}</channel></rss>`;
    const cut = full.slice(0, full.indexOf("Post 3"));
    assert.deepEqual(parseFeed(feedBody({ body: cut, truncated: true })).map((i) => i.title), ["Post 1", "Post 2"]);
  });
});

describe("publication dates", () => {
  const page = (head: string) => parseHTML(`<!doctype html><html><head>${head}</head><body><p>Text</p></body></html>`).document;

  it("reads journal metadata and JSON-LD, preferring a full day over a month", () => {
    // Nature: citation_online_date with slashes, plus dc.date.
    assert.equal(formatHint(pageDate(page('<meta name="citation_online_date" content="2026/10/03"/><meta name="dc.date" content="2026-10-03"/>'))), "2026-10-03");
    // ACL Anthology: only "2026/7" — month precision, which still proves it isn't recent.
    const acl = pageDate(page('<meta content="2026/7" name=citation_publication_date>'));
    assert.equal(formatHint(acl), "2026-07 (month only)");
    assert.equal(acl && latestPossible(acl).toISOString().slice(0, 10), "2026-07-31");
    assert.equal(formatHint(pageDate(page('<meta name="citation_publication_date" content="2026/7"><script type="application/ld+json">{"@type":"ScholarlyArticle","datePublished":"2026-07-14T00:00:00Z"}</script>'))), "2026-07-14");
    assert.equal(pageDate(page('<meta name="description" content="2026 review">')), null);
  });

  it("finds dates in URLs, including arXiv ids, and ignores numbers that aren't dates", () => {
    assert.equal(formatHint(urlDate("https://arxiv.org/html/2610.03857v1")), "2026-10 (month only)");
    assert.equal(formatHint(urlDate("https://arxiv.org/abs/2603.01234")), "2026-03 (month only)");
    assert.equal(formatHint(urlDate("https://example.com/news/2026/10/07/big-launch")), "2026-10-07");
    assert.equal(formatHint(urlDate("https://example.com/blog/2026-10-07-big-launch")), "2026-10-07");
    assert.equal(formatHint(urlDate("https://example.com/2026/09/post")), "2026-09 (month only)");
    assert.equal(urlDate("https://www.bankinfosecurity.com/openai-models-escaped-sandbox-a-32286"), null);
    assert.equal(urlDate("https://example.com/item/2026-13-45-x"), null);
  });
});

describe("research depth", () => {
  const topic = { name: "Orca migration", description: "Follow the movement of orcas between coastal habitats" };
  const longSource = { id: 1, title: "Coastal observations", text: `An initial sighting. ${"Unrelated coastal bulletin. ".repeat(240)}Orcas migrated 720 kilometres between coastal habitats in April.` };

  it("recovers late relevant evidence without implying the opening excerpt is the whole source", () => {
    const balanced = balancedEvidence(longSource, topic);
    assert.match(balanced.extract, /Orcas migrated 720 kilometres/);
    assert.ok(balanced.extract.length <= 1200);
    const deep = deepEvidence({ ...longSource, text: `${longSource.text}${" Unrelated bulletin.".repeat(1000)}` }, topic);
    assert.match(deep, /Orcas migrated 720 kilometres/);
    assert.ok(deep.length <= 12_000);
  });

  it("bounds deep model calls to three batches, retaining balanced evidence for a failed batch", async () => {
    const sources = Array.from({ length: 16 }, (_, index) => ({ id: index + 1, title: "Coastal observations", text: `${"Unrelated bulletin. ".repeat(250)}Orcas migrated near the coast ${index}.` }));
    const evidence = new Map(sources.map((source) => [source.id, balancedEvidence(source, topic)]));
    const selected = deepShortlist(sources, evidence);
    assert.equal(selected.length, 12);
    const batches: number[][] = [];
    const llm = {
      call: async (_role: string, request: { user: string }) => {
        const ids = [...request.user.matchAll(/<source id="(\d+)"/g)].map((match) => Number(match[1]));
        batches.push(ids);
        if (batches.length === 2) throw new Error("Malformed summary");
        return { summaries: ids.map((id) => ({ id, summary: `Observed orca migration ${id}` })) };
      },
    } as unknown as LlmRouter;
    const summaries = await deepSummaries(selected, topic, llm, { briefId: 1 }, { warn: () => {} } as never);
    assert.deepEqual(batches.map((batch) => batch.length), [4, 4, 4]);
    assert.equal(summaries.size, 8);
    for (const id of batches[1] ?? []) assert.equal(summaries.has(id), false);

    let calls = 0;
    const quota = { call: async () => { calls++; throw new AiError("Out of tokens / rate limited", "Quota exceeded", "test"); } } as unknown as LlmRouter;
    await assert.rejects(deepSummaries(selected, topic, quota, { briefId: 1 }, { warn: () => {} } as never), AiError);
    assert.equal(calls, 1, "a provider quota failure does not start more deep batches");
  });
});
