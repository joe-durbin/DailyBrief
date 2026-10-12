import type { ArticleDetail } from "@dailybrief/shared";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, EyeOff, MessagesSquare, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, type ComponentProps } from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { api } from "../api.ts";
import { longDate, shortDate } from "../lib/format.ts";
import { swipeRight } from "../lib/swipe.ts";
import { ChatPanel } from "../chat/ChatPanel.tsx";
import { IconButton } from "../ui/IconButton.tsx";

export type TriageAction = "ignore" | "save" | "unsave" | "delete";

type Props = {
  articleId: number;
  accent: string;
  onClose: () => void;
  onTriage: (action: TriageAction) => void;
  onRate: (rating: "up" | "down" | null) => void;
  onChatCleared?: () => void;
};

const newsDateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** "Tue 7 Oct 2026": stays meaningful after the article leaves the grid (Saved, Chats). */
const newsDate = (when: number | string) => newsDateFormat.format(new Date(when)).replace(",", "");

const isHttp = (href: string | undefined): href is string => !!href && /^https?:\/\//i.test(href);

export function ArticleOverlay({ articleId, accent, onClose, onTriage, onRate, onChatCleared }: Props) {
  const article = useQuery({ queryKey: ["article", articleId], queryFn: () => api<ArticleDetail>(`/api/articles/${articleId}`) });
  const scroller = useRef<HTMLDivElement>(null);
  const a = article.data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Turn bare [n] citations into in-page links to the sources list.
  const body = useMemo(() => a?.bodyMd.replace(/\[(\d+)\](?!\()/g, "[$1](#source-$1)") ?? "", [a?.bodyMd]);
  const words = a ? a.bodyMd.split(/\s+/).length : 0;

  const components: ComponentProps<typeof Markdown>["components"] = {
    a: ({ href, children }) => {
      if (href?.startsWith("#source-")) {
        return (
          <a
            href={href}
            className="cite"
            onClick={(e) => {
              e.preventDefault();
              scroller.current?.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            {children}
          </a>
        );
      }
      return isHttp(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      );
    },
  };

  return (
    <motion.div
      layoutId={`card-${articleId}`}
      transition={{ type: "spring", bounce: 0, duration: 0.34 }}
      style={{ borderRadius: 20 }}
      className="absolute inset-0 z-20 flex flex-col overflow-hidden border border-line-strong bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
      role="dialog"
      aria-modal="true"
      aria-label={a?.headline ?? "Article"}
      {...swipeRight(onClose)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.14, duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
            {a && (
              <>
                <span className="text-ink">{a.topicName}</span>
                <span>· {Math.max(1, Math.round(words / 230))} min read</span>
                <span className="hidden sm:inline">· {longDate(a.briefDate)}</span>
              </>
            )}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton icon={ThumbsUp} label="Good article — more like this" touchLabel="Good" active={a?.rating === "up"} onClick={() => onRate(a?.rating === "up" ? null : "up")} disabled={!a} />
            <IconButton icon={ThumbsDown} label="Not useful — less like this" touchLabel="Not useful" active={a?.rating === "down"} onClick={() => onRate(a?.rating === "down" ? null : "down")} disabled={!a} />
            <span className="mx-1.5 h-5 w-px bg-line-strong" />
            {a?.state === "saved" || a?.hasChat ? (
              <IconButton icon={Trash2} label="Delete permanently (with any chat)" touchLabel="Delete" onClick={() => onTriage("delete")} />
            ) : (
              <IconButton icon={EyeOff} label="Ignore — remove from brief" touchLabel="Ignore" onClick={() => onTriage("ignore")} disabled={!a} />
            )}
            {a?.hasChat ? (
              <IconButton icon={MessagesSquare} label="Kept in Chats" touchLabel="In Chats" active aria-disabled className="cursor-default" />
            ) : a?.state === "saved" ? (
              <IconButton icon={BookmarkCheck} label="Saved — click to unsave" touchLabel="Saved" active onClick={() => onTriage("unsave")} />
            ) : (
              <IconButton icon={Bookmark} label="Save for later" touchLabel="Save" onClick={() => onTriage("save")} disabled={!a} />
            )}
            <IconButton icon={X} label="Close" touchLabel="Close" onClick={onClose} />
          </div>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {a ? (
            <article className="mx-auto max-w-[70ch] px-5 py-8 sm:px-8 sm:py-10">
              <h1 className="text-[26px] leading-tight font-[650] tracking-[-0.02em] text-ink sm:text-[28px]">{a.headline}</h1>
              {a.publishedAt !== null && (
                <p className="mt-2 text-right text-xs text-muted tabular-nums" title={a.dateApprox ? "Estimated from the sources" : "When the news was published"}>
                  {`${a.dateApprox ? "≈ " : ""}${newsDate(a.publishedAt)}`}
                </p>
              )}
              <p className="mt-2 text-[17px] leading-relaxed text-muted">{a.summary}</p>
              <div className="my-7 h-px bg-line" />
              <div className="prose-brief">
                <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
                  {body}
                </Markdown>
              </div>

              <section className="mt-10 border-t border-line pt-6">
                <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Sources</h2>
                <ol className="space-y-2">
                  {a.sources.map((s) => (
                    <li key={s.position} id={`source-${s.position}`} className="scroll-mt-24">
                      <a
                        href={isHttp(s.url) ? s.url : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-line-strong"
                      >
                        <span className="w-5 shrink-0 text-sm font-semibold text-accent">{s.position}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-ink group-hover:underline">{s.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {s.publisher}
                            {s.publishedAt ? ` · ${shortDate(s.publishedAt)}` : ""} · {new URL(s.url).hostname.replace(/^www\./, "")}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
              <ChatPanel
                endpoint={`/api/articles/${a.id}`}
                starters={["Explain this in more depth", "Why does this matter?", "Where do the sources disagree?"]}
                onCleared={onChatCleared}
              />
            </article>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">{article.error ? article.error.message : "Loading…"}</div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
