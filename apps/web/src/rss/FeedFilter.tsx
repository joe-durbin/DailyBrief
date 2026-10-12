import type { Feed } from "@dailybrief/shared";
import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";

/** Single-feed filter in the same style as the topics filter (the native <select> list can't be themed). */
export function FeedFilter({ feeds, value, onChange }: { feeds: Feed[]; value: number | undefined; onChange: (id: number | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const enabled = feeds.filter((f) => f.enabled);
  const current = enabled.find((f) => f.id === value);
  const needle = query.trim().toLowerCase();
  const shown = enabled.filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.url.toLowerCase().includes(needle));
  const pick = (id: number | undefined) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };
  const row = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-bg/60";

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Trigger
        className={clsx(
          "flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors",
          current ? "bg-accent/15 text-accent ring-accent/40" : "text-muted ring-line hover:text-ink",
        )}
        aria-label={`Feed: ${current?.name ?? "All feeds"}`}
      >
        <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? "All feeds"}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="end" className="dialog-content z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl bg-surface-2 p-1.5 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-line-strong">
          <label className="mb-1 flex min-h-9 items-center gap-2 rounded-lg bg-bg/60 px-2.5 ring-1 ring-line focus-within:ring-accent/60">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a feed" className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
          </label>
          <ul className="max-h-80 overflow-y-auto" role="listbox" aria-label="Feeds">
            {!needle && (
              <li role="option" aria-selected={!current}>
                <button type="button" onClick={() => pick(undefined)} className={row}>
                  <Check className={clsx("size-3.5 shrink-0 text-accent", current && "invisible")} />
                  <span className="flex-1">All feeds</span>
                </button>
              </li>
            )}
            {shown.map((f) => (
              <li key={f.id} role="option" aria-selected={f.id === value}>
                <button type="button" onClick={() => pick(f.id)} className={row}>
                  <Check className={clsx("size-3.5 shrink-0 text-accent", f.id !== value && "invisible")} />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.unread > 0 && <span className="shrink-0 rounded-full bg-bg/70 px-1.5 text-[11px] leading-5 font-semibold text-muted tabular-nums">{f.unread}</span>}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-2 text-muted">No feeds match.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
