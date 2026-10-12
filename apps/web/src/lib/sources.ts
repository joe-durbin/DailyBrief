import type { Topic } from "@dailybrief/shared";
import type { FilterOption } from "../ui/MultiFilter.tsx";

/** Saved / Chats filter keys: "t<topicId>" for brief articles from a topic, "rss" for RSS items. */
const RSS = "rss";

export function sourceOptions(topics: Topic[]): FilterOption[] {
  return [...topics.map((t) => ({ key: `t${t.id}`, label: t.name, accent: t.accent })), { key: RSS, label: "From RSS", accent: "var(--color-muted)", separated: true }];
}

/** Adds the server's `topics` / `rss` params for a selection (undefined = everything, so none). */
export function setSourceParams(p: URLSearchParams, selection: string[] | undefined): void {
  if (!selection) return;
  p.set(
    "topics",
    selection.flatMap((k) => (k.startsWith("t") ? [k.slice(1)] : [])).join(","),
  );
  p.set("rss", selection.includes(RSS) ? "1" : "0");
}
