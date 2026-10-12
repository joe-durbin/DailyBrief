import type { FeedItemDetail } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ExternalLink, MessagesSquare, Rss, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { api } from "../api.ts";
import { flyTo } from "../lib/fly.ts";
import { shortDate } from "../lib/format.ts";
import { sanitizeArticleHtml } from "../lib/sanitize.ts";
import { swipeRight } from "../lib/swipe.ts";
import { ChatPanel } from "../chat/ChatPanel.tsx";
import { IconButton } from "../ui/IconButton.tsx";

type Props = {
  itemId: number | null;
  onSwipeBack?: () => void;
  /** Chats mode: offer Delete (erase the chat, stop keeping the item). */
  onDelete?: () => void;
  onChatCleared?: () => void;
};

export function ReaderPane({ itemId, onSwipeBack, onDelete, onChatCleared }: Props) {
  const queryClient = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const item = useQuery({
    queryKey: ["feed-item", itemId],
    queryFn: () => api<FeedItemDetail>(`/api/feed-items/${itemId}`),
    enabled: itemId !== null,
  });
  const save = useMutation({
    mutationFn: (saved: boolean) => api(`/api/feed-items/${itemId}/${saved ? "save" : "unsave"}`, { method: "POST" }),
    onMutate: (saved) => queryClient.setQueryData<FeedItemDetail>(["feed-item", itemId], (old) => old && { ...old, saved }),
    onSettled: () => Promise.all(["saved", "dashboard", "feed-items"].map((k) => queryClient.invalidateQueries({ queryKey: [k] }))),
  });
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [itemId]);

  const a = item.data;
  const html = useMemo(() => (a?.contentHtml ? sanitizeArticleHtml(a.contentHtml, a.url) : ""), [a?.contentHtml, a?.url]);

  if (itemId === null) {
    return (
      <section className="grid min-w-0 flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Rss className="size-6" />
          <p className="text-sm">Select an article</p>
        </div>
      </section>
    );
  }

  return (
    <section ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain" {...swipeRight(onSwipeBack)}>
      <AnimatePresence mode="wait">
        <motion.div key={itemId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {a ? (
            <>
              <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-2 backdrop-blur">
                <span className="min-w-0 truncate text-xs text-muted">
                  <span className="text-ink">{a.feedName}</span>
                  {a.publishedAt && ` · ${shortDate(a.publishedAt)}`}
                  {a.words > 200 && ` · ${Math.round(a.words / 230)} min read`}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <ExternalLink className="size-4" />
                    <span className="hidden sm:inline">Open original</span>
                  </a>
                  {onDelete && <IconButton icon={Trash2} label="Delete — erase the chat and stop keeping this article" touchLabel="Delete" onClick={onDelete} />}
                  {a.hasChat ? (
                    <IconButton icon={MessagesSquare} label="Kept in Chats" touchLabel="In Chats" active aria-disabled className="cursor-default" />
                  ) : a.saved ? (
                    <IconButton icon={BookmarkCheck} label="Saved — click to unsave" touchLabel="Saved" active onClick={() => save.mutate(false)} />
                  ) : (
                    <IconButton icon={Bookmark} label="Save for later" touchLabel="Save" onClick={(e) => {
                      flyTo("saved", e.currentTarget.getBoundingClientRect());
                      save.mutate(true);
                    }} />
                  )}
                </div>
              </header>
              <article className="mx-auto max-w-[70ch] px-5 py-8 sm:px-8 sm:py-10">
                <h1 className="text-[26px] leading-tight font-[650] tracking-[-0.02em] text-ink sm:text-[28px]">{a.title}</h1>
                {a.author && <p className="mt-2 text-sm text-muted">By {a.author}</p>}
                <div className="my-7 h-px bg-line" />
                {html ? (
                  <div className="prose-brief prose-reader" dangerouslySetInnerHTML={{ __html: html }} />
                ) : (
                  <div className="space-y-5">
                    {a.summary && <p className="prose-brief">{a.summary}</p>}
                    <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
                      The full article couldn't be loaded here (it may be paywalled or need JavaScript).
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex w-fit items-center gap-1.5 font-medium text-accent">
                        Read on {new URL(a.url).hostname.replace(/^www\./, "")} <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </div>
                )}
                <ChatPanel
                  endpoint={`/api/feed-items/${a.id}`}
                  starters={["Summarise the key points", "Explain the details", "Why does this matter?", "What happens next?"]}
                  onCleared={onChatCleared}
                />
              </article>
            </>
          ) : (
            <div className="mx-auto max-w-[70ch] px-8 py-10">
              {item.error ? (
                <p className="text-sm text-danger">{item.error.message}</p>
              ) : (
                <div className="skeleton space-y-4 rounded-2xl p-2" aria-label="Loading article">
                  <div className="h-7 w-5/6 rounded-full bg-line-strong" />
                  <div className="h-7 w-2/3 rounded-full bg-line-strong" />
                  <div className="mt-8 space-y-3">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div key={i} className="h-3 rounded-full bg-line" style={{ width: `${88 - (i % 3) * 9}%` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
