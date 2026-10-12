import type { Feed, FeedItemPage, FeedItemRow, Topic } from "@dailybrief/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { CheckCheck, Search, Settings2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { isoDay } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { FeedFilter } from "./FeedFilter.tsx";
import { MultiFilter } from "../ui/MultiFilter.tsx";
import { IconButton } from "../ui/IconButton.tsx";

/** topics: undefined = every topic; [] = none ticked (nothing to show). */
type ListFilter = { topics?: number[]; feed?: number; unread: boolean; q: string };

const dayLabel = (ms: number, now: number) => {
  const d = new Date(ms);
  const today = new Date(now);
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(d);
};

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
/**
 * Whether a publication time is real. Feeds that only give a day (allowed in RSS 1.0 / Dublin Core) parse as midnight
 * UTC — or midnight local time when the feed gives a zone — so those show no time; the day header says enough.
 */
const hasTime = (ms: number) => {
  const d = new Date(ms);
  return ms % 86_400_000 !== 0 && !(d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0);
};

type Row = { kind: "header"; label: string } | { kind: "item"; item: FeedItemRow };

/** The list unmounts when switching modes; this keeps filters, the search box and the scroll position for the session. */
const memory: { filter: ListFilter; search: string; offset: number } = { filter: { unread: false, q: "" }, search: "", offset: 0 };

export function ItemList({ selectedId, onSelect, onManageFeeds }: { selectedId: number | null; onSelect: (item: FeedItemRow) => void; onManageFeeds: () => void }) {
  const now = useNow();
  // Day headers ("Today", "Yesterday") only change when the date does.
  const today = isoDay(now);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ListFilter>(memory.filter);
  const [search, setSearch] = useState(memory.search);
  useEffect(() => {
    memory.filter = filter;
    memory.search = search;
  }, [filter, search]);
  useEffect(() => {
    const q = search.trim();
    const t = setTimeout(() => setFilter((f) => (f.q === q ? f : { ...f, q })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api<Topic[]>("/api/topics") });
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: () => api<Feed[]>("/api/feeds") });
  const params = (cursor?: string) => {
    const p = new URLSearchParams();
    if (filter.topics?.length) p.set("topics", filter.topics.join(","));
    if (filter.feed) p.set("feed", String(filter.feed));
    if (filter.unread) p.set("unread", "1");
    if (filter.q) p.set("q", filter.q);
    if (cursor) p.set("cursor", cursor);
    return p.toString();
  };
  const noTopics = filter.topics?.length === 0;
  const list = useInfiniteQuery({
    queryKey: ["feed-items", filter],
    enabled: !noTopics,
    queryFn: ({ pageParam }) => api<FeedItemPage>(`/api/feed-items?${params(pageParam)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const markAll = useMutation({
    mutationFn: () => api("/api/feed-items/read-all", { body: { topics: filter.topics?.length ? filter.topics : undefined, feed: filter.feed } }),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["feed-items"] }), queryClient.invalidateQueries({ queryKey: ["feeds"] })]),
  });

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let last = "";
    for (const item of list.data?.pages.flatMap((p) => p.items) ?? []) {
      const label = dayLabel(item.listedAt, Date.parse(`${today}T12:00:00`));
      if (label !== last) out.push({ kind: "header", label });
      last = label;
      out.push({ kind: "item", item });
    }
    return out;
  }, [list.data, today]);

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === "header" ? 34 : 78),
    overscan: 12,
    initialOffset: memory.offset,
  });
  const items = virtual.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [lastIndex, rows.length, list]);
  // Coming back to the reader: return to where the list was once its (cached) rows are laid out.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (restored.current || !rows.length) return;
    restored.current = true;
    virtual.scrollToOffset(memory.offset);
  }, [rows.length, virtual]);
  // A new filter starts at the top (but the remembered filter on return doesn't).
  const shownFilter = useRef(filter);
  useEffect(() => {
    if (shownFilter.current === filter) return;
    shownFilter.current = filter;
    virtual.scrollToOffset(0);
  }, [filter, virtual]);

  const chip = (active: boolean) =>
    clsx("min-h-8 shrink-0 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors", active ? "bg-accent/15 text-accent ring-accent/40" : "text-muted ring-line hover:text-ink");

  return (
    <section className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="space-y-3 border-b border-line p-3">
        <div className="flex items-center gap-1.5">
          <label className="flex min-h-10 flex-1 items-center gap-2 rounded-[10px] bg-bg/70 px-3 ring-1 ring-line focus-within:ring-accent/60">
            <Search className="size-4 shrink-0 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search headlines"
              className="w-full bg-transparent text-base outline-none placeholder:text-muted/70"
            />
          </label>
          <IconButton icon={CheckCheck} label="Mark all as read" onClick={() => markAll.mutate()} disabled={markAll.isPending || noTopics} />
          <IconButton icon={Settings2} label="Manage feeds" onClick={onManageFeeds} />
        </div>
        {/* One row however many topics there are: topics (multi-select), unread, single feed. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <MultiFilter
            options={(topics.data ?? []).map((t) => ({ key: String(t.id), label: t.name, accent: t.accent }))}
            value={filter.topics?.map(String)}
            onChange={(next) => setFilter((f) => ({ ...f, topics: next?.map(Number), feed: undefined }))}
            allLabel="All topics"
            noun="topics"
          />
          <button className={chip(filter.unread)} aria-pressed={filter.unread} onClick={() => setFilter((f) => ({ ...f, unread: !f.unread }))}>
            Unread
          </button>
          <FeedFilter feeds={feeds.data ?? []} value={filter.feed} onChange={(feed) => setFilter((f) => ({ ...f, feed, topics: undefined }))} />
        </div>
      </div>

      <div ref={scroller} onScroll={(e) => (memory.offset = e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {noTopics ? (
          <p className="p-6 text-center text-sm text-muted">No topics ticked — choose some under the topics filter.</p>
        ) : (
          list.data && rows.length === 0 && <p className="p-6 text-center text-sm text-muted">{filter.q || filter.unread || filter.topics || filter.feed ? "Nothing matches these filters." : "No articles fetched yet."}</p>
        )}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {items.map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            return (
              <div key={v.key} data-index={v.index} ref={virtual.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${v.start}px)` }}>
                {row.kind === "header" ? (
                  <div className="bg-surface/95 px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{row.label}</div>
                ) : (
                  <button
                    onClick={() => onSelect(row.item)}
                    className={clsx("relative flex w-full gap-3 px-4 py-2.5 text-left transition-colors", row.item.id === selectedId ? "bg-surface-2" : "hover:bg-surface-2/50")}
                  >
                    {row.item.id === selectedId && <motion.span layoutId="rss-selection" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent" />}
                    <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", row.item.read ? "bg-transparent" : "bg-accent")} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("line-clamp-2 text-[14px] leading-snug", row.item.read ? "text-muted" : "font-medium text-ink")}>{row.item.title}</span>
                      <span className="mt-1 flex gap-1.5 text-xs text-muted">
                        <span className="truncate">{row.item.feedName}</span>
                        {row.item.publishedAt !== null && hasTime(row.item.publishedAt) && <span className="shrink-0 tabular-nums">· {clock.format(row.item.publishedAt)}</span>}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
