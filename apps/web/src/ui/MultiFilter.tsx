import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Check, ChevronDown, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

export type FilterOption = {
  key: string;
  label: string;
  /** Colour dot (topics); otherwise `icon`. */
  accent?: string;
  icon?: ReactNode;
  /** Draw a divider above this option (e.g. "From RSS" after the topics). */
  separated?: boolean;
};

/** Show a search box in the panel once there are this many options. */
const SEARCH_FROM = 8;

/**
 * Multi-select filter pill: summarises the choice ("All topics", "AI Security", "3 selected"), opens a panel of
 * checkboxes with Select all / Clear and a per-row "Only". `value` undefined = everything (no filter); [] = none.
 */
export function MultiFilter({ options, value, onChange, allLabel, noun }: { options: FilterOption[]; value: string[] | undefined; onChange: (next: string[] | undefined) => void; allLabel: string; noun: string }) {
  const [query, setQuery] = useState("");
  const all = value === undefined;
  const selected = new Set(all ? options.map((o) => o.key) : value);
  // Ticking every option is the same as no filter.
  const set = (keys: string[]) => onChange(keys.length === options.length ? undefined : keys);
  const toggle = (key: string) => set(selected.has(key) ? [...selected].filter((k) => k !== key) : [...selected, key]);
  const needle = query.trim().toLowerCase();
  const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const first = options.find((o) => selected.has(o.key));
  const label = all ? allLabel : selected.size === 0 ? `No ${noun}` : selected.size === 1 && first ? first.label : `${selected.size} ${noun}`;

  return (
    <Popover.Root onOpenChange={(open) => !open && setQuery("")}>
      <Popover.Trigger
        className={clsx(
          "flex min-h-8 max-w-56 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors",
          all ? "text-muted ring-line hover:text-ink" : "bg-accent/15 text-accent ring-accent/40",
        )}
        aria-label={`${noun[0]?.toUpperCase()}${noun.slice(1)}: ${label}`}
      >
        {!all && selected.size === 1 && first?.accent && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: first.accent }} />}
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" className="dialog-content z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl bg-surface-2 p-1.5 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-line-strong">
          {options.length >= SEARCH_FROM && (
            <label className="mb-1 flex min-h-9 items-center gap-2 rounded-lg bg-bg/60 px-2.5 ring-1 ring-line focus-within:ring-accent/60">
              <Search className="size-3.5 shrink-0 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" className="w-full bg-transparent text-base outline-none placeholder:text-muted/70" />
            </label>
          )}
          <div className="flex items-center justify-between px-2 py-1 text-xs">
            <span className="text-muted">
              {selected.size} of {options.length} shown
            </span>
            <button type="button" onClick={() => onChange(selected.size === options.length ? [] : undefined)} className="min-h-7 rounded-md px-1.5 font-medium text-accent hover:bg-bg/60">
              {selected.size === options.length ? "Clear" : "Select all"}
            </button>
          </div>
          <div className="my-1 h-px bg-line" />
          <ul className="max-h-72 overflow-y-auto" role="listbox" aria-multiselectable aria-label={noun}>
            {shown.map((o) => (
              <li key={o.key} className={clsx(o.separated && !needle && "mt-1 border-t border-line pt-1")}>
                <div className="group flex items-center rounded-lg hover:bg-bg/60" role="option" aria-selected={selected.has(o.key)}>
                  <button type="button" onClick={() => toggle(o.key)} className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 px-2 text-left">
                    <span className={clsx("grid size-4 shrink-0 place-items-center rounded ring-1", selected.has(o.key) ? "bg-accent text-on-accent ring-accent" : "ring-line-strong")}>
                      {selected.has(o.key) && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    {o.accent ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: o.accent }} /> : o.icon}
                    <span className="truncate">{o.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => set([o.key])}
                    className="mr-1 min-h-7 shrink-0 rounded-md px-1.5 text-xs text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
                    aria-label={`Only ${o.label}`}
                  >
                    Only
                  </button>
                </div>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-2 text-muted">No matches.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
