import type { ArticleDetail, BriefInfo, BriefView, Topic } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Loader2, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../api.ts";
import { flyTo } from "../lib/fly.ts";
import { isoDay, longDate } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { ArticleCard, SkeletonCard } from "./ArticleCard.tsx";
import { ArticleOverlay, type TriageAction } from "./ArticleOverlay.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { DateNav } from "./DateNav.tsx";
import { RegenerateButton } from "./RegenerateButton.tsx";

const IN_FLIGHT = new Set(["queued", "gathering", "selecting", "writing"]);
const inFlight = (b: BriefInfo | null) => !!b && IN_FLIGHT.has(b.status);
/** Wait for the overlay to shrink back into its slot before removing the card. */
const CLOSE_MS = 340;
const STAGGER = 0.035;

/** `date` = a previous brief (YYYY-MM-DD); undefined = today's. */
export function BriefPane({ topic, date, onOpenTopics }: { topic: Topic; date?: string; onOpenTopics: () => void }) {
  const queryClient = useQueryClient();
  // Today's brief is keyed by the actual date, so it's fetched afresh when the day rolls over.
  const today = isoDay(useNow());
  const key = ["brief", topic.id, date ?? `today:${today}`];
  const view = useQuery({ queryKey: key, queryFn: () => api<BriefView>(`/api/topics/${topic.id}/brief${date ? `?date=${date}` : ""}`) });
  const isPast = date !== undefined;
  const [openId, setOpenId] = useState<number | null>(null);
  // Cards present on first paint stagger in; cards arriving later (live) animate individually.
  const initialIds = useRef<Set<number> | null>(null);
  if (view.data && !initialIds.current) initialIds.current = new Set(view.data.slots.flatMap((c) => (c ? [c.id] : [])));

  const patchCard = useCallback(
    (articleId: number, fn: (c: NonNullable<BriefView["slots"][number]>) => BriefView["slots"][number]) =>
      queryClient.setQueryData<BriefView>(key, (old) => old && { ...old, slots: old.slots.map((c) => (c?.id === articleId ? fn(c) : c)) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, topic.id],
  );

  const triage = useMutation({
    mutationFn: ({ id, action }: { id: number; action: TriageAction }) =>
      action === "delete" ? api(`/api/articles/${id}`, { method: "DELETE" }) : api(`/api/articles/${id}/${action}`, { method: "POST" }),
    // Saving, ignoring or deleting also changes Saved and the dashboard's "Saved for later".
    onSettled: () => Promise.all([key, ["topics"], ["saved"], ["dashboard"]].map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
  const rate = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: "up" | "down" | null }) => api(`/api/articles/${id}/rating`, { method: "PUT", body: { rating } }),
    onMutate: ({ id, rating }) => {
      patchCard(id, (c) => ({ ...c, rating }));
      queryClient.setQueryData<ArticleDetail>(["article", id], (old) => old && { ...old, rating });
    },
    onError: (_e, { id }) => void queryClient.invalidateQueries({ queryKey: ["article", id] }),
  });
  const regenerate = useMutation({
    mutationFn: () => api(`/api/topics/${topic.id}/refresh`, { method: "POST" }),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: key }), queryClient.invalidateQueries({ queryKey: ["topics"] })]),
  });

  /** Close the overlay, then (once it has shrunk back) take the card out of the grid. */
  const removeAfterClose = (id: number, then: () => void) => {
    setOpenId(null);
    setTimeout(() => {
      patchCard(id, () => null);
      then();
    }, CLOSE_MS);
  };

  const onTriage = (action: TriageAction) => {
    const id = openId;
    if (id === null) return;
    if (action === "unsave") {
      triage.mutate({ id, action });
      queryClient.setQueryData<ArticleDetail>(["article", id], (old) => old && { ...old, state: "active" });
      return;
    }
    if (action === "delete" && !window.confirm("Delete this article permanently? Any chat about it is erased too.")) return;
    const cell = document.querySelector(`[data-card-cell="${id}"]`)?.getBoundingClientRect();
    removeAfterClose(id, () => {
      if (action === "save") flyTo("saved", cell);
      triage.mutate({ id, action });
    });
  };

  /** Chatting keeps an article (the server moved it to Chats), so it leaves the grid like a save. */
  const onClose = () => {
    const id = openId;
    if (id === null) return;
    if (!queryClient.getQueryData<ArticleDetail>(["article", id])?.hasChat) return setOpenId(null);
    const cell = document.querySelector(`[data-card-cell="${id}"]`)?.getBoundingClientRect();
    removeAfterClose(id, () => {
      flyTo("chats", cell);
      void queryClient.invalidateQueries({ queryKey: ["topics"] });
    });
  };

  if (!view.data) return <div className="grid flex-1 place-items-center text-sm text-muted">{view.error?.message ?? ""}</div>;

  const { brief, running, slots, warning } = view.data;
  // Briefs run one at a time: a topic waiting its turn has no run yet, but the server reports it as generating.
  const queued = topic.generating && isPast === false && inFlight(brief) === false && inFlight(running) === false;
  const busy = inFlight(brief) || inFlight(running) || queued || regenerate.isPending;
  const generatingGrid = inFlight(brief);
  const cardCount = slots.filter(Boolean).length;
  const statusLine = (inFlight(running) ? running : inFlight(brief) ? brief : null)?.detail ?? (queued ? "Waiting for another brief to finish…" : undefined);
  const failed = brief?.status === "failed" && !running;

  return (
    <section className="@container relative flex min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-5">
      <div className="mb-4 flex min-h-10 items-center gap-2">
        <IconButton icon={PanelLeftOpen} label="Show topics" onClick={onOpenTopics} className="-ml-2 min-[900px]:hidden" />
        <h2 className="text-[15px] font-semibold">{topic.name}</h2>
        <DateNav topicId={topic.id} current={brief?.briefDate ?? date} />
        {brief && !generatingGrid && cardCount > 0 && <span className="hidden text-sm text-muted sm:inline">· {cardCount} left</span>}
        <div className="ml-auto flex items-center gap-3">
          <AnimatePresence>
            {statusLine && (
              <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                <span className="hidden sm:inline">{statusLine}</span>
              </motion.span>
            )}
          </AnimatePresence>
          {!isPast && <RegenerateButton topicName={topic.name} busy={busy} hasCards={cardCount > 0} onConfirm={() => regenerate.mutate()} />}
        </div>
      </div>
      {isPast && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-2.5 text-sm ring-1 ring-line">
          <span className="text-muted">
            Viewing the brief from <span className="text-ink">{longDate(date)}</span>
          </span>
          <Link to={`/briefs/${topic.id}`} className="font-medium text-accent">
            Back to today
          </Link>
        </div>
      )}
      {warning && !(failed && cardCount === 0) && <AiWarning message={warning} />}

      <LayoutGroup>
        <div className="relative grid flex-1 auto-rows-[minmax(190px,1fr)] grid-cols-2 gap-4 @[680px]:grid-cols-3 @[1040px]:grid-cols-5 @[1040px]:grid-rows-3">
          {slots.map((card, i) => (
            <div key={i} className="min-h-0" data-card-cell={card?.id}>
              <AnimatePresence mode="popLayout">
                {card && card.id !== openId ? (
                  <ArticleCard
                    key={card.id}
                    card={card}
                    accent={topic.accent}
                    delay={initialIds.current?.has(card.id) ? i * STAGGER : 0}
                    onOpen={() => setOpenId(card.id)}
                  />
                ) : !card && generatingGrid ? (
                  <SkeletonCard key="skeleton" index={i} />
                ) : null}
              </AnimatePresence>
            </div>
          ))}

          {!brief && !running && queued && (
            <EmptyMessage title="Brief queued" body={`Today's ${topic.name} brief is pending generation. It starts as soon as the brief ahead of it finishes.`} />
          )}
          {!brief && !running && !generatingGrid && !queued && (
            <EmptyMessage title={isPast ? "No brief that day" : "No brief yet"} body={isPast ? "There's no brief for this date." : `Today's ${topic.name} brief hasn't been generated.`} action={isPast ? undefined : "Generate now"} onAction={() => regenerate.mutate()} />
          )}
          {failed && cardCount === 0 && (
            <EmptyMessage title="This brief couldn't be generated" body={brief.error ?? "Something went wrong."} action="Try again" onAction={() => regenerate.mutate()} error />
          )}
          {brief && !busy && !failed && cardCount === 0 && (
            <EmptyMessage title="All caught up" body={isPast ? "Every card in this brief has been saved or ignored." : "You've been through today's brief. The next one arrives tomorrow morning."} />
          )}

          <AnimatePresence>
            {openId !== null && (
              <>
                <motion.div
                  key="backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute -inset-2 z-10 rounded-3xl bg-bg/60 backdrop-blur-[2px]"
                  onClick={onClose}
                />
                <ArticleOverlay
                  key={`overlay-${openId}`}
                  articleId={openId}
                  accent={topic.accent}
                  onClose={onClose}
                  onTriage={onTriage}
                  onRate={(rating) => rate.mutate({ id: openId, rating })}
                />
              </>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </section>
  );
}

/** "Out of tokens / rate limited — LiteLLM (openai) said: …": the reason in bold, the provider's words after it. */
function AiWarning({ message }: { message: string }) {
  const cut = message.indexOf(" — ");
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mb-4 flex gap-2.5 rounded-xl bg-warn/10 px-4 py-2.5 text-sm ring-1 ring-warn/30">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
      <p className="min-w-0 text-ink/90">
        {cut > 0 ? (
          <>
            <span className="font-semibold text-ink">{message.slice(0, cut)}</span> — {message.slice(cut + 3)}
          </>
        ) : (
          message
        )}
      </p>
    </motion.div>
  );
}

function EmptyMessage({ title, body, action, onAction, error }: { title: string; body: string; action?: string; onAction?: () => void; error?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto max-w-sm rounded-2xl border border-line bg-surface/90 px-6 py-5 text-center backdrop-blur">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          {error && <AlertCircle className="size-4 text-danger" />}
          {title}
        </p>
        <p className="mt-1 text-sm text-muted">{body}</p>
        {action && (
          <button onClick={onAction} className="mt-4 min-h-9 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110">
            {action}
          </button>
        )}
      </div>
    </motion.div>
  );
}
