import type { ArticleDetail, ChatEntry, ChatsPage, Topic } from "@dailybrief/shared";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, MessagesSquare, Rss, Search } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api.ts";
import { ArticleOverlay, type TriageAction } from "../briefs/ArticleOverlay.tsx";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { setSourceParams, sourceOptions } from "../lib/sources.ts";
import { MultiFilter } from "../ui/MultiFilter.tsx";
import { useMediaQuery } from "../lib/media.ts";
import { ReaderPane } from "../rss/ReaderPane.tsx";

/** sources: undefined = everything; otherwise filter keys from lib/sources.ts. */
type Filter = { sources?: string[]; q: string };
const FALLBACK_ACCENT = "#98A2B3";
/** URL segment per kind: /chats/article/12, /chats/rss/34. */
const SEGMENT: Record<ChatEntry["kind"], string> = { article: "article", "feed-item": "rss" };

/** Articles with a conversation: list on the left, the article + its chat on the right (like the RSS reader). */
export function ChatsView() {
  const now = useNow();
  const { kind: segment, id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const split = useMediaQuery("(min-width: 680px)");
  const wide = useMediaQuery("(min-width: 900px)");
  const selected = id && (segment === "article" || segment === "rss") ? { kind: segment === "rss" ? ("feed-item" as const) : ("article" as const), id: Number(id) } : null;

  const [filter, setFilter] = useState<Filter>({ q: "" });
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => ({ ...f, q: search.trim() })), 250);
    return () => clearTimeout(t);
  }, [search]);

  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api<Topic[]>("/api/topics") });
  const accentOf = (topicId: number | null) => topics.data?.find((t) => t.id === topicId)?.accent ?? FALLBACK_ACCENT;
  const list = useInfiniteQuery({
    queryKey: ["chats", filter],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ offset: pageParam });
      setSourceParams(p, filter.sources);
      if (filter.q) p.set("q", filter.q);
      return api<ChatsPage>(`/api/chats?${p}`);
    },
    initialPageParam: "0",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = list.data?.pages.flatMap((p) => p.items) ?? [];

  const deselect = () => navigate("/chats", { replace: split });
  const remove = useMutation({
    mutationFn: (e: { kind: ChatEntry["kind"]; id: number }) => api(e.kind === "article" ? `/api/articles/${e.id}` : `/api/feed-items/${e.id}`, { method: "DELETE" }),
    onSettled: () => Promise.all(["chats", "saved", "feed-items", "topics"].map((k) => queryClient.invalidateQueries({ queryKey: [k] }))),
  });
  const rate = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: "up" | "down" | null }) => api(`/api/articles/${id}/rating`, { method: "PUT", body: { rating } }),
    onMutate: ({ id, rating }) => queryClient.setQueryData<ArticleDetail>(["article", id], (old) => old && { ...old, rating }),
  });

  const confirmDelete = (message: string) => {
    if (!selected || !window.confirm(message)) return;
    remove.mutate(selected);
    deselect();
  };
  // After "Clear conversation" only Delete/Unsave remain meaningful; the article now lives in Saved.
  const onTriage = (action: TriageAction) => {
    if (!selected) return;
    if (action === "delete") return confirmDelete("Delete this article permanently? Its chat is erased too.");
    void api(`/api/articles/${selected.id}/${action}`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: ["article", selected.id] }));
  };

  const listPane = (
    <section className="flex min-h-0 flex-col border-r border-line bg-surface">
      <div className="space-y-3 border-b border-line p-3">
        <label className="flex min-h-10 items-center gap-2 rounded-[10px] bg-bg/70 px-3 ring-1 ring-line focus-within:ring-accent/60">
          <Search className="size-4 shrink-0 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
        </label>
        <div className="flex">
          <MultiFilter options={sourceOptions(topics.data ?? [])} value={filter.sources} onChange={(sources) => setFilter((f) => ({ ...f, sources }))} allLabel="All chats" noun="sources" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {list.data && entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-muted">
            <MessagesSquare className="size-6" />
            <p className="text-sm font-medium text-ink">{filter.q || filter.sources ? "No chats match" : "No chats yet"}</p>
            {!filter.q && !filter.sources && <p className="text-sm">Ask a question about any article and it's kept here with its conversation.</p>}
          </div>
        )}
        <ul>
          {entries.map((e) => {
            const active = selected?.kind === e.kind && selected.id === e.id;
            return (
              <li key={`${e.kind}-${e.id}`}>
                <button
                  onClick={() => navigate(`/chats/${SEGMENT[e.kind]}/${e.id}`, { replace: split && selected !== null })}
                  className={clsx("relative flex w-full gap-3 px-4 py-3 text-left transition-colors", active ? "bg-surface-2" : "hover:bg-surface-2/50")}
                >
                  {active && <motion.span layoutId="chat-selection" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent" />}
                  <span className="mt-1.5 shrink-0">
                    {e.kind === "article" ? <span className="block size-2 rounded-full" style={{ backgroundColor: accentOf(e.topicId) }} /> : <Rss className="size-3 text-muted" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[14px] leading-snug font-medium text-ink">{e.title}</span>
                    {e.lastQuestion && <span className="mt-1 line-clamp-1 text-[13px] text-muted italic">“{e.lastQuestion}”</span>}
                    <span className="mt-1 flex gap-1.5 text-xs text-muted">
                      <span className="truncate">{e.source}</span>
                      <span className="shrink-0">· {timeAgo(e.lastAt, now)}</span>
                      <span className="shrink-0">· {Math.ceil(e.messages / 2)} {e.messages > 2 ? "questions" : "question"}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {list.hasNextPage && (
          <button onClick={() => void list.fetchNextPage()} className="mx-auto my-3 block min-h-10 rounded-[10px] px-4 text-sm text-muted ring-1 ring-line hover:text-ink">
            {list.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  );

  const detailPane = !selected ? (
    <section className="grid min-w-0 flex-1 place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <MessagesSquare className="size-6" />
        <p className="text-sm">Select a chat to pick up the conversation.</p>
      </div>
    </section>
  ) : selected.kind === "article" ? (
    <section className="relative min-h-0 min-w-0 p-3 sm:p-4">
      <div className="relative h-full">
        <ArticleOverlay
          key={selected.id}
          articleId={selected.id}
          accent={accentOf(entries.find((e) => e.kind === "article" && e.id === selected.id)?.topicId ?? null)}
          onClose={deselect}
          onTriage={onTriage}
          onRate={(rating) => rate.mutate({ id: selected.id, rating })}
          onChatCleared={deselect}
        />
      </div>
    </section>
  ) : (
    <ReaderPane
      itemId={selected.id}
      onSwipeBack={split ? undefined : deselect}
      onDelete={() => confirmDelete("Remove this article from Chats? The conversation is erased.")}
      onChatCleared={deselect}
    />
  );

  if (!split) {
    return (
      <div className="flex h-full flex-col">
        {selected === null ? (
          listPane
        ) : (
          <>
            <button onClick={deselect} className="flex min-h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-sm text-muted">
              <ArrowLeft className="size-4" /> All chats
            </button>
            {detailPane}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: wide ? "minmax(320px, min(30%, 480px)) 1fr" : "300px 1fr" }}>
      {listPane}
      {detailPane}
    </div>
  );
}
