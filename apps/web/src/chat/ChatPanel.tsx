import { LOOK_FURTHER_NONE, type ChatMessage, type ChatStreamEvent } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, Globe, Loader2, MessageSquare, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { api } from "../api.ts";

type Props = {
  /** `/api/articles/12` or `/api/feed-items/34`. */
  endpoint: string;
  starters: string[];
  /** The conversation was cleared (the article moves from Chats to Saved). */
  onCleared?: () => void;
};

const NOTE = `\n\n_${LOOK_FURTHER_NONE}_`;
/** Lists whose membership changes when a conversation starts or is cleared (Chats ⇄ Saved, grid, details). */
const AFFECTED = new Set(["chats", "saved", "article", "feed-item", "feed-items", "topics"]);

const isHttp = (href?: string) => !!href && /^https?:\/\//i.test(href);

/** "Chat with this article": collapsed pill that expands into a grounded, streaming chat. */
export function ChatPanel({ endpoint, starters, onCleared }: Props) {
  const queryClient = useQueryClient();
  const key = ["chat", endpoint];
  const history = useQuery({ queryKey: key, queryFn: () => api<ChatMessage[]>(`${endpoint}/chat`) });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [lookFurther, setLookFurther] = useState(false);
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = history.data ?? [];
  const refreshLists = () => queryClient.invalidateQueries({ predicate: (q) => AFFECTED.has(String(q.queryKey[0])) });

  useEffect(() => {
    if (messages.length) setOpen(true);
  }, [messages.length]);
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, messages.length, pending?.answer]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setDraft("");
    setError(null);
    setPending({ question: q, answer: "" });
    try {
      const res = await fetch(`${endpoint}/chat`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, lookFurther }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The assistant couldn't answer just now.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          if (!raw.startsWith("data: ")) continue;
          const ev = JSON.parse(raw.slice(6)) as ChatStreamEvent;
          if (ev.type === "delta") setPending((p) => p && { ...p, answer: p.answer + ev.text });
          if (ev.type === "error") setError(ev.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await Promise.all([queryClient.invalidateQueries({ queryKey: key }), refreshLists()]);
      setPending(null);
    }
  };

  const clear = useMutation({
    mutationFn: () => api(`${endpoint}/chat`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData<ChatMessage[]>(key, []);
      void refreshLists();
      onCleared?.();
    },
  });

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(draft);
    }
  };

  const bubbles: { role: "user" | "assistant"; content: string; streaming?: boolean; key: string }[] = [
    ...messages.map((m) => ({ role: m.role, content: m.content, key: String(m.id) })),
    ...(pending ? [{ role: "user" as const, content: pending.question, key: "pq" }, { role: "assistant" as const, content: pending.answer, streaming: true, key: "pa" }] : []),
  ];

  return (
    <section className="mt-10 border-t border-line pt-6">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mx-auto flex min-h-11 items-center gap-2 rounded-full bg-surface px-5 text-sm font-medium text-ink ring-1 ring-line-strong transition-colors [@media(hover:hover)]:hover:bg-surface-2"
        >
          <MessageSquare className="size-4 text-accent" /> Chat with this article
        </button>
      ) : (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }} className="overflow-hidden">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">Chat with this article</h2>
            {messages.length > 0 && !pending && (
              <button
                onClick={() => clear.mutate()}
                title="Erase the conversation; the article moves to Saved"
                className="ml-auto flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted hover:text-ink"
              >
                <Trash2 className="size-3.5" /> Clear conversation
              </button>
            )}
          </div>

          <div className="space-y-3 font-sans">
            <AnimatePresence initial={false}>
              {bubbles.map((b) => (
                <motion.div
                  key={b.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={clsx(b.role === "user" ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-[15px] text-ink" : "chat-answer max-w-full text-[15px] leading-relaxed text-ink/90")}
                >
                  {b.role === "user" ? (
                    b.content
                  ) : b.content ? (
                    <>
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                        components={{
                          a: ({ href, children }) =>
                            isHttp(href) ? (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                              </a>
                            ) : (
                              <span>{children}</span>
                            ),
                        }}
                      >
                        {b.content.endsWith(NOTE) ? b.content.slice(0, -NOTE.length) : b.content}
                      </Markdown>
                      {b.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent/70 align-text-bottom" />}
                      {b.content.endsWith(NOTE) && (
                        <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-2 font-sans text-xs text-muted italic">
                          <Globe className="size-3.5 shrink-0" /> {LOOK_FURTHER_NONE}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="size-3.5 animate-spin" /> {lookFurther ? "Searching the web and thinking…" : "Thinking…"}
                    </span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>

          {!bubbles.length && (
            <div className="mb-3 flex flex-wrap gap-2">
              {starters.map((s) => (
                <button key={s} onClick={() => void ask(s)} className="min-h-9 rounded-full px-3.5 text-[13px] text-muted ring-1 ring-line transition-colors hover:text-ink [@media(hover:hover)]:hover:ring-line-strong">
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-2xl bg-surface p-2 ring-1 ring-line focus-within:ring-accent/60">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Ask a follow-up question…"
              className="block w-full resize-none bg-transparent px-2 py-1.5 font-sans text-base text-ink outline-none placeholder:text-muted/70"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 font-sans text-xs text-muted select-none" title="Also search the web for this question">
                <input type="checkbox" checked={lookFurther} onChange={(e) => setLookFurther(e.target.checked)} className="size-4 accent-accent" />
                <Globe className="size-3.5" /> Look further
              </label>
              <button
                onClick={() => void ask(draft)}
                disabled={!draft.trim() || !!pending}
                aria-label="Send"
                className="grid size-9 place-items-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-40 [@media(pointer:coarse)]:size-11"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </button>
            </div>
          </div>
          <div ref={bottom} />
        </motion.div>
      )}
    </section>
  );
}
