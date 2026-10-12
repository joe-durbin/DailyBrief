import { TOPIC_ACCENTS, type Feed, type FeedSuggestions, type TopicDetail } from "@dailybrief/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, Loader2, RotateCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError } from "../api.ts";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";

const EXAMPLE =
  "e.g. New PC and console game releases, major patches and studio news, written for a keen player. Skip rumours, deals and sales.";
const input = "w-full rounded-[10px] bg-bg/70 px-3 py-2.5 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";

/** `topicId === null` → add a topic; otherwise edit it. */
export function TopicDialog({ open, topicId, onOpenChange }: { open: boolean; topicId: number | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const editing = topicId !== null;
  const detail = useQuery({ queryKey: ["topic", topicId], queryFn: () => api<TopicDetail>(`/api/topics/${topicId}`), enabled: open && editing });
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: () => api<Feed[]>("/api/feeds"), enabled: open });
  const [form, setForm] = useState({ name: "", description: "", accent: TOPIC_ACCENTS[0] as string, feedIds: [] as number[], regenerate: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedMode, setFeedMode] = useState<"mine" | "ai">("mine");
  /** New feeds found by "Let AI pick": created only when the topic is saved, and only those still ticked. */
  const [newFeeds, setNewFeeds] = useState<(FeedSuggestions["discovered"][number] & { checked: boolean })[]>([]);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setFeedSearch("");
    setFeedMode("mine");
    setNewFeeds([]);
    suggest.reset();
    if (!editing) setForm({ name: "", description: "", accent: TOPIC_ACCENTS[0], feedIds: [], regenerate: false });
    else if (detail.data) setForm({ name: detail.data.name, description: detail.data.description, accent: detail.data.accent, feedIds: detail.data.feedIds, regenerate: false });
  }, [open, editing, detail.data]);

  const refresh = () => Promise.all(["topics", "topic", "feeds", "feed-items", "brief"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const suggest = useMutation({
    mutationFn: () => api<FeedSuggestions>("/api/topics/suggest-feeds", { body: { name: form.name, description: form.description } }),
    onSuccess: (r) => {
      // Relevant feeds you already have are ticked, except quiet ones (shown, but left for you to decide).
      const tick = r.existing.filter((e) => !e.quiet).map((e) => e.feedId);
      setForm((f) => ({ ...f, feedIds: [...new Set([...f.feedIds, ...tick])] }));
      setNewFeeds(r.discovered.map((d) => ({ ...d, checked: true })));
    },
  });
  const [adding, setAdding] = useState<string | null>(null);
  /** "Let AI pick" without previewing: the server picks feeds as the next brief's first step. */
  const background = feedMode === "ai" && !suggest.data && !suggest.isPending;
  const save = useMutation({
    mutationFn: async () => {
      // Add the ticked new feeds first; each one that succeeds becomes an ordinary ticked feed, so a retry after a
      // failure doesn't add it twice.
      let feedIds = form.feedIds;
      for (const nf of newFeeds.filter((n) => n.checked)) {
        setAdding(nf.name);
        try {
          const { id } = await api<{ id: number }>("/api/feeds", { body: { url: nf.feedUrl, name: nf.name } });
          feedIds = [...feedIds, id];
        } catch (e) {
          // Already added (e.g. by an earlier attempt): link the existing one instead.
          const existing = e instanceof ApiError && e.status === 409 ? (await api<Feed[]>("/api/feeds")).find((f) => f.url === nf.feedUrl) : undefined;
          if (!existing) {
            setAdding(null);
            throw new Error(`Couldn't add ${nf.name}: ${e instanceof Error ? e.message : String(e)}. Untick it to continue.`);
          }
          feedIds = [...feedIds, existing.id];
        }
        setForm((f) => ({ ...f, feedIds }));
        setNewFeeds((list) => list.filter((n) => n.feedUrl !== nf.feedUrl));
      }
      setAdding(null);
      const body = { ...form, regenerate: form.regenerate || background, feedIds: [...new Set(feedIds)], autoFeeds: background };
      return editing
        ? api(`/api/topics/${topicId}`, { method: "PATCH", body })
        : api<{ id: number }>("/api/topics", { body: { name: body.name, description: body.description, accent: body.accent, feedIds: body.feedIds, autoFeeds: background } });
    },
    onSuccess: async (res) => {
      await refresh();
      onOpenChange(false);
      if (!editing && res && typeof res === "object" && "id" in res) navigate(`/briefs/${res.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/topics/${topicId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
      navigate("/briefs");
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const toggleFeed = (id: number) => setForm((f) => ({ ...f, feedIds: f.feedIds.includes(id) ? f.feedIds.filter((x) => x !== id) : [...f.feedIds, id] }));
  const len = form.description.trim().length;
  const needle = feedSearch.trim().toLowerCase();
  const shownFeeds = (feeds.data ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.url.toLowerCase().includes(needle));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[20px] border border-line bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none">
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <Dialog.Title className="text-lg font-semibold tracking-tight">{editing ? "Edit topic" : "New topic"}</Dialog.Title>
              <Dialog.Close type="button" aria-label="Close" className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-bg/60 hover:text-ink">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Topic name, description and linked feeds</Dialog.Description>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">Name</span>
                <input className={input} value={form.name} maxLength={40} required onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Computer Games, UK Politics, Cloud Security" />
              </label>

              <label className="block space-y-1.5">
                <span className="flex justify-between text-xs font-medium text-muted">
                  Description
                  <span className={clsx("tabular-nums", (len > 0 && len < 20) || len > 1000 ? "text-danger" : "")}>{len} / 1000</span>
                </span>
                <textarea
                  className={clsx(input, "min-h-32 resize-y leading-relaxed")}
                  value={form.description}
                  required
                  minLength={20}
                  maxLength={1000}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={EXAMPLE}
                />
                <span className="block text-xs text-muted">
                  Describe what this brief should cover and who it's for — the subject, the angle you care about, how technical it should be, and what to leave out. This steers what's searched for, selected and how
                  it's written.
                </span>
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted">Colour</span>
                <div className="flex flex-wrap gap-2">
                  {TOPIC_ACCENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      aria-pressed={form.accent === c}
                      onClick={() => setForm({ ...form, accent: c })}
                      className={clsx("grid size-9 place-items-center rounded-full ring-2 transition-transform", form.accent === c ? "scale-110 ring-ink/70" : "ring-transparent")}
                      style={{ backgroundColor: c }}
                    >
                      {form.accent === c && <Check className="size-4 text-on-accent" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="flex justify-between text-xs font-medium text-muted">
                  <span>
                    RSS feeds for this topic <span className="font-normal">(optional)</span>
                  </span>
                  <span className="tabular-nums">{form.feedIds.length + newFeeds.filter((n) => n.checked).length} selected</span>
                </span>
                <p className="text-xs text-muted">
                  Stories are found by web search whether or not you pick any feeds. Feeds you tick here are also checked for stories, and their articles appear under this topic in the RSS reader.
                </p>
                <div className="flex w-fit rounded-[10px] bg-bg/60 p-0.5 ring-1 ring-line" role="radiogroup" aria-label="How to choose feeds">
                  {(
                    [
                      ["mine", "Choose from my feeds"],
                      ["ai", "Let AI pick"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={feedMode === mode}
                      onClick={() => setFeedMode(mode)}
                      className={clsx("flex min-h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors", feedMode === mode ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink")}
                    >
                      {mode === "ai" && <Sparkles className="size-3.5 text-accent" />}
                      {label}
                    </button>
                  ))}
                </div>
                {feedMode === "ai" ? (
                  <AiFeedPicker
                    editing={editing}
                    ready={form.name.trim().length > 0 && len >= 20}
                    suggest={suggest}
                    feedIds={form.feedIds}
                    onToggleFeed={toggleFeed}
                    newFeeds={newFeeds}
                    onToggleNew={(url) => setNewFeeds((list) => list.map((n) => (n.feedUrl === url ? { ...n, checked: !n.checked } : n)))}
                  />
                ) : (
                <div className="rounded-xl bg-bg/40 ring-1 ring-line">
                  {(feeds.data?.length ?? 0) > 6 && (
                    <label className="flex min-h-10 items-center gap-2 border-b border-line px-3">
                      <Search className="size-4 shrink-0 text-muted" />
                      <input value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)} placeholder="Find a feed" className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
                    </label>
                  )}
                  <div className="max-h-56 space-y-0.5 overflow-y-auto p-1.5">
                    {shownFeeds.map((f) => (
                      <label key={f.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-surface/60">
                        <input type="checkbox" checked={form.feedIds.includes(f.id)} onChange={() => toggleFeed(f.id)} className="size-4 accent-accent" />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        {!f.enabled && <span className="shrink-0 text-xs text-muted">off</span>}
                      </label>
                    ))}
                    {feeds.data && shownFeeds.length === 0 && <p className="px-2 py-2 text-sm text-muted">{feedSearch ? "No feeds match." : "No feeds yet — add them in RSS → Manage feeds."}</p>}
                  </div>
                </div>
                )}
              </div>

              {editing && (
                <label className="flex items-start gap-2.5 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={form.regenerate || background}
                    disabled={background}
                    onChange={(e) => setForm({ ...form, regenerate: e.target.checked })}
                    className="mt-0.5 size-4 accent-accent"
                  />
                  {background ? "Regenerate today's brief — feeds are picked as its first step" : "Regenerate today's brief with these changes (unsaved articles are replaced)"}
                </label>
              )}
            </div>

            {(save.error || remove.error) && <p className="px-6 pt-2 text-sm text-danger">{(save.error ?? remove.error)?.message}</p>}
            <div className="flex items-center gap-2 border-t border-line px-6 py-4">
              {editing &&
                (confirmDelete ? (
                  <button type="button" onClick={() => remove.mutate()} className="min-h-10 rounded-[10px] bg-danger/15 px-3 text-sm font-semibold text-danger">
                    {remove.isPending ? "Deleting…" : "Delete topic — saved articles are kept"}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-sm text-muted hover:text-danger">
                    <Trash2 className="size-4" /> Delete
                  </button>
                ))}
              <div className="ml-auto flex gap-2">
                <Dialog.Close type="button" className="min-h-10 rounded-[10px] px-4 text-sm text-muted hover:text-ink">
                  Cancel
                </Dialog.Close>
                <button disabled={save.isPending || suggest.isPending} className="flex min-h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110 disabled:opacity-60">
                  {save.isPending && <Loader2 className="size-4 animate-spin" />}
                  {adding ? `Adding ${adding}…` : editing ? "Save changes" : "Create and generate"}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const lastPost = (ms: number | null, now: number) => (ms ? `last post ${timeAgo(ms, now)}` : "no posts yet");
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** "Let AI pick": relevant feeds you have (quiet ones flagged, not ticked) plus new, checked, active feeds to add. */
function AiFeedPicker({
  editing,
  ready,
  suggest,
  feedIds,
  onToggleFeed,
  newFeeds,
  onToggleNew,
}: {
  editing: boolean;
  ready: boolean;
  suggest: { mutate: () => void; isPending: boolean; data?: FeedSuggestions; error: Error | null };
  feedIds: number[];
  onToggleFeed: (id: number) => void;
  newFeeds: (FeedSuggestions["discovered"][number] & { checked: boolean })[];
  onToggleNew: (feedUrl: string) => void;
}) {
  const now = useNow();
  const r = suggest.data;
  const row = "flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-surface/60";

  if (suggest.isPending) {
    return (
      <div className="skeleton space-y-3 rounded-xl bg-bg/40 p-4 ring-1 ring-line" aria-label="Finding feeds">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Reading your feeds and searching for new ones… (about 15–30 seconds)
        </p>
        {[85, 70, 78, 62].map((w) => (
          <div key={w} className="h-3 rounded-full bg-line" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!r) {
    return (
      <div className="space-y-3 rounded-xl bg-bg/40 p-4 ring-1 ring-line">
        <p className="flex gap-2 text-sm text-ink/90">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>
            Just press <b>{editing ? "Save changes" : "Create and generate"}</b>: DailyBrief picks feeds in the background — linking suitable feeds you already have and adding new, active ones — before writing the
            brief.
          </span>
        </p>
        <p className="text-xs text-muted">Or preview and choose the feeds now (takes 15–30 seconds). Feeds added in the background can be reviewed later in the topic's settings or RSS → Manage feeds.</p>
        <button
          type="button"
          onClick={() => suggest.mutate()}
          disabled={!ready}
          className="flex min-h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-medium text-muted ring-1 ring-line transition-colors hover:text-ink disabled:opacity-50"
        >
          Preview feeds now
        </button>
        {!ready && <p className="text-xs text-muted">Add a name and a description to preview.</p>}
        {suggest.error && <p className="text-sm text-danger">{suggest.error.message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-bg/40 p-3 ring-1 ring-line">
      <section>
        <h4 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">From your feeds</h4>
        {r.existing.length ? (
          r.existing.map((e) => (
            <label key={e.feedId} className={row}>
              <input type="checkbox" checked={feedIds.includes(e.feedId)} onChange={() => onToggleFeed(e.feedId)} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{e.name}</span>
                  {e.quiet ? (
                    <span className="flex items-center gap-1 text-xs text-warn">
                      <AlertTriangle className="size-3" /> quiet — {lastPost(e.lastPostAt, now)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{lastPost(e.lastPostAt, now)}</span>
                  )}
                </span>
                <span className="block text-xs text-muted">{e.reason}</span>
              </span>
            </label>
          ))
        ) : (
          <p className="px-2 py-1 text-sm text-muted">None of your current feeds fit this topic.</p>
        )}
      </section>

      <section className="border-t border-line pt-3">
        <h4 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">New feeds to add</h4>
        {newFeeds.length ? (
          newFeeds.map((n) => (
            <label key={n.feedUrl} className={row}>
              <input type="checkbox" checked={n.checked} onChange={() => onToggleNew(n.feedUrl)} className="mt-0.5 size-4 shrink-0 accent-accent" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{n.name}</span>
                  <span className="text-xs text-muted">
                    {hostOf(n.feedUrl)} · {lastPost(n.lastPostAt, now)}
                  </span>
                </span>
                <span className="block text-xs text-muted">{n.reason}</span>
              </span>
            </label>
          ))
        ) : (
          <p className="px-2 py-1 text-sm text-muted">{r.discovered.length ? "All new feeds have been added." : "No new active feeds found."}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2.5">
        {r.rejected.length > 0 ? (
          <details className="group text-xs text-muted">
            <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-ink">
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              {r.rejected.length} {r.rejected.length === 1 ? "suggestion" : "suggestions"} skipped
            </summary>
            <ul className="mt-1.5 space-y-0.5 pl-4">
              {r.rejected.map((x) => (
                <li key={x.url}>
                  {x.name} — {x.why}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-xs text-muted">New feeds must have posted in the last {r.inactiveDays} days.</span>
        )}
        <button type="button" onClick={() => suggest.mutate()} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted hover:text-ink">
          <RotateCw className="size-3.5" /> Search again
        </button>
      </div>
    </div>
  );
}
