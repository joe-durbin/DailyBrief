import type { Feed, FeedPreview, Topic } from "@dailybrief/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertCircle, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { shortDate, timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";
import { IconButton } from "../ui/IconButton.tsx";

const input = "min-h-10 w-full rounded-[10px] bg-bg/70 px-3 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";

/** Which briefs use this feed (read-only: assignment lives in each topic's settings). */
function TopicTags({ topics, ids }: { topics: Topic[]; ids: number[] }) {
  const used = topics.filter((t) => ids.includes(t.id));
  if (!used.length) return <p className="text-xs text-muted/70">Reader only — not used in any brief</p>;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {used.map((t) => (
        <span key={t.id} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: t.accent }} />
          {t.name}
        </span>
      ))}
    </p>
  );
}

function AddFeed({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const preview = useMutation({
    mutationFn: () => api<FeedPreview>("/api/feeds/preview", { body: { url } }),
    onSuccess: (p) => setName(p.title ?? new URL(p.feedUrl).hostname),
  });
  const add = useMutation({
    mutationFn: () => api("/api/feeds", { body: { url: preview.data?.feedUrl, name } }),
    onSuccess: () => {
      setUrl("");
      setName("");
      preview.reset();
      onAdded();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (preview.data) add.mutate();
    else preview.mutate();
  };
  const p = preview.data;

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-line bg-surface p-4">
      <p className="mb-3 text-sm font-medium">Add a feed</p>
      <div className="flex gap-2">
        <input
          className={input}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (preview.data || preview.error) preview.reset();
          }}
          placeholder="Feed or website address, e.g. blog.example.com"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        {!p && (
          <button disabled={preview.isPending} className="flex min-h-10 shrink-0 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-sm font-medium hover:bg-surface-2 disabled:opacity-60">
            {preview.isPending && <Loader2 className="size-4 animate-spin" />}
            Check
          </button>
        )}
      </div>
      {preview.error && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" />
          {preview.error.message}
        </p>
      )}
      {p && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-muted">
            Found <span className="text-ink">{p.itemCount} articles</span>
            {p.latest && `, latest ${shortDate(p.latest)}`}
            <span className="mt-0.5 block truncate text-xs">{p.feedUrl}</span>
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </label>
          <p className="text-xs text-muted">To use it in a topic's brief, tick it in that topic's settings (Edit topics → pencil).</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => preview.reset()} className="min-h-10 rounded-[10px] px-4 text-sm text-muted hover:text-ink">
              Cancel
            </button>
            <button disabled={add.isPending} className="flex min-h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110 disabled:opacity-60">
              {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add feed
            </button>
          </div>
          {add.error && <p className="text-sm text-danger">{add.error.message}</p>}
        </div>
      )}
    </form>
  );
}

function FeedRow({ feed, topics }: { feed: Feed; topics: Topic[] }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const refresh = () => Promise.all(["feeds", "feed-items", "saved", "chats"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
  const patch = useMutation({ mutationFn: (body: Partial<Pick<Feed, "enabled">>) => api(`/api/feeds/${feed.id}`, { method: "PATCH", body }), onSettled: refresh });
  const fetchNow = useMutation({ mutationFn: () => api(`/api/feeds/${feed.id}/fetch`, { method: "POST" }), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api(`/api/feeds/${feed.id}`, { method: "DELETE" }), onSettled: refresh });
  const [confirming, setConfirming] = useState(false);
  const status = feed.lastError ? "error" : feed.lastFetchedAt ? "ok" : "pending";

  return (
    <li className={clsx("rounded-2xl border border-line bg-surface p-3.5", !feed.enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className={clsx("mt-1.5 size-2 shrink-0 rounded-full", status === "ok" ? "bg-emerald-400" : status === "error" ? "bg-danger" : "bg-muted")}
          title={feed.lastError ?? (feed.lastFetchedAt ? "Fetched OK" : "Not fetched yet")}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{feed.name}</p>
          <p className="truncate text-xs text-muted">{feed.url}</p>
          <p className={clsx("mt-0.5 text-xs", feed.lastError ? "text-danger" : "text-muted")}>
            {feed.lastError ? `Last fetch failed: ${feed.lastError}` : feed.lastFetchedAt ? `Updated ${timeAgo(feed.lastFetchedAt, now)}` : "Not fetched yet"}
          </p>
        </div>
        <label className="flex min-h-10 shrink-0 cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={feed.enabled} onChange={(e) => patch.mutate({ enabled: e.target.checked })} className="size-4 accent-accent" />
          On
        </label>
        <IconButton icon={RefreshCw} label="Fetch now" onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending} iconClassName={clsx(fetchNow.isPending && "animate-spin")} />
        {confirming ? (
          <button onClick={() => remove.mutate()} className="min-h-10 shrink-0 rounded-[10px] bg-danger/15 px-3 text-xs font-semibold text-danger">
            Remove?
          </button>
        ) : (
          <IconButton icon={Trash2} label="Remove feed" onClick={() => setConfirming(true)} />
        )}
      </div>
      <div className="mt-2.5 pl-5">
        <TopicTags topics={topics} ids={feed.topicIds} />
      </div>
      {confirming && (
        <p className="mt-2 pl-5 text-xs text-muted">
          Its articles leave the reader.{" "}
          {feed.kept > 0 ? `${feed.kept} saved ${feed.kept === 1 ? "article is" : "articles are"} kept (in Saved / Chats).` : "Nothing from it is saved."}{" "}
          <button onClick={() => setConfirming(false)} className="font-medium text-ink underline underline-offset-2">
            Cancel
          </button>
        </p>
      )}
      {fetchNow.error && <p className="mt-2 pl-5 text-xs text-danger">{fetchNow.error.message}</p>}
    </li>
  );
}

export function ManageFeeds({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const feeds = useQuery({ queryKey: ["feeds"], queryFn: () => api<Feed[]>("/api/feeds"), enabled: open });
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api<Topic[]>("/api/topics") });
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = feeds.data?.filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.url.toLowerCase().includes(needle));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[20px] border border-line bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight">Manage feeds</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">Feeds appear in the reader. Which feeds a topic's brief uses is set in that topic's settings.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-bg/60 hover:text-ink">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            <AddFeed onAdded={() => Promise.all([queryClient.invalidateQueries({ queryKey: ["feeds"] }), queryClient.invalidateQueries({ queryKey: ["feed-items"] })])} />
            <label className="flex min-h-10 items-center gap-2 rounded-[10px] bg-bg/70 px-3 ring-1 ring-line focus-within:ring-accent/60">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${feeds.data?.length ?? ""} feeds by name or address`}
                aria-label="Filter feeds by name or address"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70"
              />
              <Search className="size-4 shrink-0 text-muted" />
            </label>
            <ul className="space-y-2.5">
              {shown?.map((f) => (
                <FeedRow key={f.id} feed={f} topics={topics.data ?? []} />
              ))}
            </ul>
            {shown && shown.length === 0 && needle && <p className="py-4 text-center text-sm text-muted">No feeds match “{filter.trim()}”.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
