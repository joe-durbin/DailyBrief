import type { AppSettings, AuthState, Dashboard } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, ArrowUpRight, Check, X, BookmarkCheck, CheckCircle2, Loader2, MessagesSquare, Rss, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { ArticleOverlay, type TriageAction } from "../briefs/ArticleOverlay.tsx";
import { AiReminder, Welcome } from "./Welcome.tsx";
import { shortDate, timeAgo, usd } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";

const FALLBACK_ACCENT = "#98A2B3";
const STAGGER = 0.05;

const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
const fullDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "today 05:00" / "tomorrow 05:00" from the schedule's HH:MM. */
function nextBrief(time: string, now: Date): string {
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() < hh * 60 + mm ? `today ${time}` : `tomorrow ${time}`;
}

const duration = (ms: number | null) => (ms === null ? "running" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** The landing page: an overview of today across topics before diving into articles. */
export function DashboardView() {
  const now = useNow();
  const nowDate = new Date(now);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api<AuthState>("/api/auth/state") });
  const data = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings") });
  const [open, setOpen] = useState<{ id: number; accent: string } | null>(null);

  const refresh = () => Promise.all(["dashboard", "brief", "topics", "saved", "chats"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const triage = useMutation({
    mutationFn: ({ id, action }: { id: number; action: TriageAction }) =>
      action === "delete" ? api(`/api/articles/${id}`, { method: "DELETE" }) : api(`/api/articles/${id}/${action}`, { method: "POST" }),
    onSettled: refresh,
  });
  const rate = useMutation({
    mutationFn: ({ id, rating }: { id: number; rating: "up" | "down" | null }) => api(`/api/articles/${id}/rating`, { method: "PUT", body: { rating } }),
    onSettled: (_d, _e, { id }) => Promise.all([queryClient.invalidateQueries({ queryKey: ["article", id] }), refresh()]),
  });
  const onTriage = (action: TriageAction) => {
    if (!open) return;
    if (action === "delete" && !window.confirm("Delete this article permanently? Any chat about it is erased too.")) return;
    triage.mutate({ id: open.id, action });
    if (action === "unsave") void queryClient.invalidateQueries({ queryKey: ["article", open.id] });
    else setOpen(null);
  };

  const d = data.data;
  if (!d) return <div className="grid h-full place-items-center text-sm text-muted">{data.error?.message ?? ""}</div>;
  if (d.empty) return <Welcome aiReady={d.aiReady} />;

  const accentOf = (topicId: number | null) => d.topics.find((t) => t.id === topicId)?.accent ?? FALLBACK_ACCENT;
  const openArticle = (id: number, topicId: number | null) => setOpen({ id, accent: accentOf(topicId) });
  const ready = d.topics.filter((t) => t.status === "ready" || t.status === "warning").length;
  const generating = d.topics.filter((t) => t.status === "generating").length;
  const toTriage = d.topics.reduce((n, t) => n + t.remaining, 0);
  const statusParts = [
    generating ? `${plural(generating, "brief")} generating` : `${plural(ready, "brief")} ready`,
    `${plural(toTriage, "card")} to triage`,
    `${d.rssUnread} unread in RSS`,
    settings.data ? `next brief ${nextBrief(settings.data.schedule.time, nowDate)}` : null,
  ].filter(Boolean);
  const warnings = d.topics.filter((t) => t.warning);
  let section = 0;
  const reveal = () => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { delay: section++ * STAGGER, duration: 0.3, ease: [0.2, 0, 0, 1] as const } });

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          <motion.header {...reveal()}>
            <h1 className="text-[26px] leading-tight font-[650] tracking-[-0.02em]">
              {greeting(nowDate.getHours())}
              {auth.data?.username ? `, ${auth.data.username}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {fullDate.format(nowDate)} · {statusParts.join(" · ")}
            </p>
            {warnings.map((t) => (
              <p key={t.id} role="alert" className="mt-3 flex gap-2 rounded-xl bg-warn/10 px-3.5 py-2 text-sm ring-1 ring-warn/30">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>
                  <span className="font-semibold">{t.name}:</span> {t.warning}
                </span>
              </p>
            ))}
            {!d.aiReady && (
              <div className="mt-3">
                <AiReminder />
              </div>
            )}
          </motion.header>

          {/* Hidden (not removed) when empty so it adds no section gap; warnings animate in and out inside it. */}
          <div className={clsx("space-y-2", !d.inactiveFeeds.length && "hidden")}>
            <AnimatePresence initial={false}>
              {d.inactiveFeeds.map((f) => (
                <InactiveFeed key={f.id} feed={f} days={d.inactiveDays} onDone={refresh} />
              ))}
            </AnimatePresence>
          </div>

          <motion.div {...reveal()}>
            <Panel title="Continue where you left off">
              <div className="grid gap-3 md:grid-cols-3">
                <Resume
                  icon={<Rss className="size-4 text-accent" />}
                  label="Last read in RSS"
                  empty="Nothing read yet."
                  item={d.continue.read && { title: d.continue.read.title, detail: `${d.continue.read.feedName} · ${timeAgo(d.continue.read.at, now)}` }}
                  onOpen={() => d.continue.read && navigate(`/rss/${d.continue.read.id}`)}
                />
                <div className="rounded-xl bg-bg/40 p-3.5 ring-1 ring-line">
                  <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                    <BookmarkCheck className="size-4 text-accent" /> Saved for later
                  </p>
                  {d.continue.saved.length ? (
                    <ul className="space-y-1">
                      {d.continue.saved.map((s) => (
                        <li key={`${s.kind}-${s.id}`}>
                          <button
                            onClick={() => (s.kind === "article" ? openArticle(s.id, null) : navigate(`/rss/${s.id}`))}
                            className="block w-full truncate rounded-md py-0.5 text-left text-sm text-ink/90 hover:text-accent"
                            title={`${s.title} — ${s.source}`}
                          >
                            {s.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>Nothing waiting — saved articles you haven't opened yet show up here.</Empty>
                  )}
                </div>
                <Resume
                  icon={<MessagesSquare className="size-4 text-accent" />}
                  label="Latest chat"
                  empty="No conversations yet."
                  item={d.continue.chat && { title: d.continue.chat.title, detail: `“${d.continue.chat.lastQuestion}” · ${timeAgo(d.continue.chat.at, now)}` }}
                  onOpen={() => d.continue.chat && navigate(`/chats/${d.continue.chat.kind === "article" ? "article" : "rss"}/${d.continue.chat.id}`)}
                />
              </div>
            </Panel>
          </motion.div>

          <div className="grid gap-4 lg:grid-cols-3">
            <motion.div {...reveal()} className="lg:col-span-2">
              <Panel title="Today's themes" icon={<Sparkles className="size-4 text-accent" />}>
                {d.themes.items.length ? (
                  <ul className="space-y-4">
                    {d.themes.items.map((th) => (
                      <li key={th.title}>
                        <p className="font-semibold text-ink">{th.title}</p>
                        <p className="mt-0.5 text-sm text-muted">{th.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {th.articles.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => openArticle(a.id, a.topicId)}
                              className="flex max-w-full min-h-8 items-center gap-1.5 rounded-full bg-bg/60 px-3 text-left text-[13px] text-ink/90 ring-1 ring-line transition-colors hover:ring-line-strong"
                            >
                              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accentOf(a.topicId) }} />
                              <span className="truncate">{a.headline}</span>
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : d.themes.status === "pending" ? (
                  <div className="skeleton space-y-3 rounded-xl p-1" aria-label="Finding today's themes">
                    <p className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="size-3.5 animate-spin" /> Finding today's themes…
                    </p>
                    {[80, 65, 72].map((w) => (
                      <div key={w} className="h-3 rounded-full bg-line" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : (
                  <Empty>Themes appear once today's briefs have been written.</Empty>
                )}
              </Panel>
            </motion.div>

            <motion.div {...reveal()}>
              <Panel title="Most mentioned this week">
                {d.mentions.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {d.mentions.map((m) => (
                      <span
                        key={m.name}
                        title={`${plural(m.count, "article")} this week${m.trend === "new" ? " — new this week" : m.trend === "up" ? " — more than last week" : ""}`}
                        className="flex min-h-8 items-center gap-1.5 rounded-full bg-bg/60 px-3 text-[13px] ring-1 ring-line"
                      >
                        {m.name}
                        <span className="text-xs text-muted tabular-nums">{m.count}</span>
                        {m.trend === "new" && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold text-accent uppercase">new</span>}
                        {m.trend === "up" && <ArrowUpRight className="size-3.5 text-accent" aria-label="rising" />}
                      </span>
                    ))}
                  </div>
                ) : (
                  <Empty>Names that keep coming up across your briefs will appear here.</Empty>
                )}
              </Panel>
            </motion.div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <motion.div {...reveal()} className="lg:col-span-2">
              <WeekPanel week={d.week} />
            </motion.div>
            <motion.div {...reveal()}>
              <HealthPanel health={d.health} />
            </motion.div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div key="dash-overlay" className="absolute inset-0 z-10 p-3 sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-bg/60 backdrop-blur-[2px]" onClick={() => setOpen(null)} />
            <div className="relative h-full">
              <ArticleOverlay articleId={open.id} accent={open.accent} onClose={() => setOpen(null)} onTriage={onTriage} onRate={(rating) => rate.mutate({ id: open.id, rating })} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="h-full rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;

function Resume({ icon, label, item, empty, onOpen }: { icon: ReactNode; label: string; item: { title: string; detail: string } | null; empty: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} disabled={!item} className="flex flex-col items-stretch justify-start rounded-xl bg-bg/40 p-3.5 text-left ring-1 ring-line transition-colors enabled:hover:ring-line-strong">
      <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
        {icon} {label}
      </span>
      {item ? (
        <>
          <span className="line-clamp-2 text-sm font-medium text-ink">{item.title}</span>
          <span className="mt-1 line-clamp-1 text-xs text-muted">{item.detail}</span>
        </>
      ) : (
        <span className="text-sm text-muted">{empty}</span>
      )}
    </button>
  );
}

function WeekPanel({ week }: { week: Dashboard["week"] }) {
  const max = Math.max(1, ...week.days.map((d) => d.opened + d.saved + d.ignored));
  const totals = week.days.reduce((t, d) => ({ opened: t.opened + d.opened, saved: t.saved + d.saved, ignored: t.ignored + d.ignored, rssRead: t.rssRead + d.rssRead }), { opened: 0, saved: 0, ignored: 0, rssRead: 0 });
  const bars = [
    { key: "opened", label: "Opened", className: "bg-accent/35" },
    { key: "saved", label: "Saved", className: "bg-accent" },
    { key: "ignored", label: "Ignored", className: "bg-muted/40" },
  ] as const;
  return (
    <Panel title="Your week">
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="flex h-32 items-end gap-2" role="img" aria-label="Brief cards opened, saved and ignored per day this week">
            {week.days.map((d) => (
              <div key={d.date} className="flex h-full flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full max-w-9 flex-1 flex-col-reverse overflow-hidden rounded-md bg-bg/50">
                  {bars.map((b) => (
                    <motion.div
                      key={b.key}
                      className={b.className}
                      initial={{ height: 0 }}
                      animate={{ height: `${(d[b.key] / max) * 100}%` }}
                      transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
                      title={`${b.label}: ${d[b.key]}`}
                    />
                  ))}
                </div>
                <span className="text-[11px] text-muted">{weekday.format(new Date(`${d.date}T12:00:00`))}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {bars.map((b) => (
              <span key={b.key} className="flex items-center gap-1.5">
                <span className={clsx("size-2 rounded-sm", b.className)} /> {b.label} {totals[b.key]}
              </span>
            ))}
            <span>· RSS read {totals.rssRead}</span>
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:w-56 sm:grid-cols-1">
          <div>
            <dt className="text-xs text-muted">Ratings this week</dt>
            <dd className="mt-0.5 flex items-center gap-3 font-medium">
              <span className="flex items-center gap-1">
                <ThumbsUp className="size-3.5 text-accent" /> {week.ratings.up}
              </span>
              <span className="flex items-center gap-1">
                <ThumbsDown className="size-3.5 text-muted" /> {week.ratings.down}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Publishers you rate highest</dt>
            <dd className="mt-0.5 font-medium">{week.topPublishers.length ? week.topPublishers.map((p) => p.name).join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Articles chatted about</dt>
            <dd className="mt-0.5 font-medium">{week.chats}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">In Saved</dt>
            <dd className="mt-0.5 font-medium">{week.savedTotal}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

function HealthPanel({ health }: { health: Dashboard["health"] }) {
  const ai = health.aiToday;
  const unknown = ai.filter((m) => m.costUsd === null).length;
  const spend = ai.reduce((s, m) => s + (m.costUsd ?? 0), 0);
  return (
    <Panel title="System health">
      <ul className="space-y-2 text-sm">
        {health.runs.map((r) => (
          <li key={r.topicId} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{r.topicName}</span>
            <span className={clsx("shrink-0 text-xs tabular-nums", r.status === "failed" ? "text-warn" : "text-muted")}>
              {r.status === "failed" ? "failed" : `${r.cards} cards · ${duration(r.durationMs)}`}
            </span>
          </li>
        ))}
        {!health.runs.length && <li className="text-muted">No runs yet today.</li>}
      </ul>
      <div className="my-4 h-px bg-line" />
      <p className="mb-2 flex items-baseline justify-between text-sm">
        <span>AI usage today</span>
        {ai.length > 0 && unknown < ai.length && <span className="text-xs text-muted tabular-nums">{unknown ? `${usd(spend)}+` : usd(spend)}</span>}
      </p>
      {ai.length ? (
        <>
          <ul className="space-y-2">
            {ai.map((m) => (
              <li key={`${m.provider}-${m.model}`} className="text-xs">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-ink/90" title={`${m.provider} · ${m.model}`}>
                    {m.model}
                  </span>
                  <span className="shrink-0 text-muted tabular-nums">{m.costUsd === null ? "—" : usd(m.costUsd)}</span>
                </p>
                <p className="text-muted tabular-nums">
                  {m.provider} · {m.calls} {m.calls === 1 ? "call" : "calls"} · {compact.format(m.tokensIn)} in / {compact.format(m.tokensOut)} out
                </p>
              </li>
            ))}
          </ul>
          {unknown > 0 && <p className="mt-2 text-[11px] text-muted">Models with unknown pricing are shown with —.</p>}
        </>
      ) : (
        <p className="text-xs text-muted">No AI calls yet today.</p>
      )}
      <div className="my-4 h-px bg-line" />
      {health.failingFeeds.length ? (
        <div className="text-sm">
          <p className="flex items-center gap-1.5 text-warn">
            <AlertTriangle className="size-3.5" /> {plural(health.failingFeeds.length, "feed")} failing
          </p>
          <p className="mt-1 text-xs text-muted">{health.failingFeeds.map((f) => f.name).join(", ")} — see RSS → Manage feeds.</p>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CheckCircle2 className="size-3.5 text-emerald-400" /> All feeds fetching
        </p>
      )}
    </Panel>
  );
}

/** "Feed X hasn't posted in N days" (Settings → RSS): ✓ removes the feed (saved articles are kept), ✕ dismisses until it goes quiet again. */
function InactiveFeed({ feed, days, onDone }: { feed: Dashboard["inactiveFeeds"][number]; days: number; onDone: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (action: "remove" | "dismiss") => (action === "remove" ? api(`/api/feeds/${feed.id}`, { method: "DELETE" }) : api(`/api/feeds/${feed.id}/dismiss-inactive`, { method: "POST" })),
    onSettled: () => Promise.all([onDone(), queryClient.invalidateQueries({ queryKey: ["feeds"] }), queryClient.invalidateQueries({ queryKey: ["feed-items"] })]),
  });
  const since = feed.lastPostAt ? `last post ${shortDate(feed.lastPostAt)}` : "no posts yet";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
      className="overflow-hidden"
    >
      <div role="alert" className="flex items-center gap-3 rounded-xl bg-warn/10 px-4 py-2.5 text-sm ring-1 ring-warn/30">
        <Rss className="size-4 shrink-0 text-warn" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{feed.name}</span> hasn't posted in {days} days ({since}
          {feed.topics.length ? ` · used by ${feed.topics.join(", ")}` : ""}). Remove it?
        </p>
        <button
          onClick={() => act.mutate("remove")}
          disabled={act.isPending}
          title="Remove this feed (saved articles are kept)"
          aria-label={`Remove ${feed.name}`}
          className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-warn/20 text-ink transition-colors hover:bg-warn/30 disabled:opacity-50"
        >
          <Check className="size-4" />
        </button>
        <button
          onClick={() => act.mutate("dismiss")}
          disabled={act.isPending}
          title="Keep it and hide this warning"
          aria-label={`Dismiss warning for ${feed.name}`}
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-muted transition-colors hover:bg-bg/60 hover:text-ink disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}
