import type { ArticleDetail, SavedEntry, SavedPage, Topic } from "@dailybrief/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Rss, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { ArticleOverlay, type TriageAction } from "../briefs/ArticleOverlay.tsx";
import { shortDate } from "../lib/format.ts";
import { setSourceParams, sourceOptions } from "../lib/sources.ts";
import { MultiFilter } from "../ui/MultiFilter.tsx";

/** sources: undefined = everything; otherwise filter keys from lib/sources.ts. */
type Filter = { sources?: string[]; q: string; sort: "saved" | "published" };
const FALLBACK_ACCENT = "#98A2B3";

export function SavedView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>({ q: "", sort: "saved" });
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, q: search.trim() })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api<Topic[]>("/api/topics") });
  const accentOf = (topicId: number) => topics.data?.find((t) => t.id === topicId)?.accent ?? FALLBACK_ACCENT;
  const list = useInfiniteQuery({
    queryKey: ["saved", filter],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ sort: filter.sort, offset: pageParam });
      setSourceParams(p, filter.sources);
      if (filter.q) p.set("q", filter.q);
      return api<SavedPage>(`/api/saved?${p}`);
    },
    initialPageParam: "0",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = list.data?.pages.flatMap((p) => p.items) ?? [];

  const triage = useMutation({
    mutationFn: ({ id, action }: { id: number; action: TriageAction }) =>
      action === "delete" ? api(`/api/articles/${id}`, { method: "DELETE" }) : api(`/api/articles/${id}/${action}`, { method: "POST" }),
    onSettled: () => Promise.all(["saved", "chats", "brief", "topics"].map((k) => queryClient.invalidateQueries({ queryKey: [k] }))),
  });
  const rate = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: "up" | "down" | null }) => api(`/api/articles/${id}/rating`, { method: "PUT", body: { rating } }),
    onMutate: ({ id, rating }) => queryClient.setQueryData<ArticleDetail>(["article", id], (old) => old && { ...old, rating }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["saved"] }),
  });

  const onTriage = (action: TriageAction) => {
    if (openId === null) return;
    if (action === "delete" && !window.confirm("Delete this article permanently? Any chat about it is erased too.")) return;
    triage.mutate({ id: openId, action });
    if (action === "unsave") queryClient.setQueryData<ArticleDetail>(["article", openId], (old) => old && { ...old, state: "active" });
    else setOpenId(null);
  };
  const open = (e: SavedEntry) => (e.kind === "article" ? setOpenId(e.id) : navigate(`/rss/${e.id}`));

  const openEntry = entries.find((e) => e.kind === "article" && e.id === openId);

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold">Saved</h2>
            <label className="ml-auto flex min-h-10 min-w-56 flex-1 items-center gap-2 rounded-[10px] bg-surface px-3 ring-1 ring-line focus-within:ring-accent/60 sm:flex-none">
              <Search className="size-4 shrink-0 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search saved" className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
            </label>
            <select
              value={filter.sort}
              onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value === "published" ? "published" : "saved" }))}
              className="min-h-10 rounded-[10px] bg-surface px-2.5 text-base text-ink ring-1 ring-line outline-none"
              aria-label="Sort"
            >
              <option value="saved">Recently saved</option>
              <option value="published">Recently published</option>
            </select>
          </div>
          <div className="mb-5 flex">
            <MultiFilter options={sourceOptions(topics.data ?? [])} value={filter.sources} onChange={(sources) => setFilter((f) => ({ ...f, sources }))} allLabel="All saved" noun="sources" />
          </div>

          {list.data && entries.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center text-muted">
              <Bookmark className="size-6" />
              <p className="text-sm font-medium text-ink">{filter.q || filter.sources ? "No saved articles match" : "Nothing saved yet"}</p>
              {!filter.q && !filter.sources && <p className="text-sm">Articles you save from briefs or RSS will appear here.</p>}
            </div>
          )}

          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {entries.map((e) => (
                <motion.li key={`${e.kind}-${e.id}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
                  <button onClick={() => open(e)} className="flex w-full gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors [@media(hover:hover)]:hover:border-line-strong">
                    <span className="mt-1.5 shrink-0">
                      {e.kind === "article" ? <span className="block size-2.5 rounded-full" style={{ backgroundColor: accentOf(e.topicId) }} /> : <Rss className="size-3.5 text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[15px] leading-snug font-semibold">{e.title}</span>
                      {e.summary && <span className="mt-1 line-clamp-1 text-sm text-muted">{e.summary}</span>}
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                        <span>{e.kind === "article" ? e.topicName : "RSS"}</span>
                        <span>· {e.source}</span>
                        <span>· saved {shortDate(e.savedAt)}</span>
                        {e.kind === "article" && e.rating === "up" && <ThumbsUp className="size-3.5 text-accent" />}
                        {e.kind === "article" && e.rating === "down" && <ThumbsDown className="size-3.5" />}
                      </span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {list.hasNextPage && (
            <button onClick={() => void list.fetchNextPage()} className="mx-auto mt-4 block min-h-10 rounded-[10px] px-4 text-sm text-muted ring-1 ring-line hover:text-ink">
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {openId !== null && (
          <motion.div key="saved-overlay" className="absolute inset-0 z-10 p-3 sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-bg/60 backdrop-blur-[2px]" onClick={() => setOpenId(null)} />
            <div className="relative h-full">
              <ArticleOverlay
                articleId={openId}
                accent={openEntry?.kind === "article" ? accentOf(openEntry.topicId) : FALLBACK_ACCENT}
                onClose={() => setOpenId(null)}
                onTriage={onTriage}
                onRate={(rating) => rate.mutate({ id: openId, rating })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
