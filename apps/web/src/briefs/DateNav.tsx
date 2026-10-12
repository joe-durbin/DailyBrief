import type { BriefDate } from "@dailybrief/shared";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { isoDay, longDate } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A month as "YYYY-MM"; `shift` steps it by whole months. */
const monthOf = (iso: string) => iso.slice(0, 7);
function shift(month: string, by: number): string {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Monday-first grid of ISO dates for a month; null pads the leading/trailing cells. */
function monthGrid(month: string): (string | null)[] {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * ‹ date › — the arrows step through days that have a brief; the date opens a calendar where those days are
 * marked (bold, accent, dot) and every other day is greyed out. Today's brief lives at /briefs/:topic,
 * past ones at /briefs/:topic/:date.
 */
export function DateNav({ topicId, current }: { topicId: number; current?: string }) {
  const navigate = useNavigate();
  const today = isoDay(useNow());
  const shown = current ?? today;
  const dates = useQuery({ queryKey: ["brief-dates", topicId], queryFn: () => api<BriefDate[]>(`/api/topics/${topicId}/briefs`) });
  const withBrief = new Set(dates.data?.map((d) => d.date));
  const all = [...new Set([today, ...withBrief])].sort().reverse();
  const idx = all.indexOf(shown);
  const older = idx >= 0 ? all[idx + 1] : undefined;
  const newer = idx > 0 ? all[idx - 1] : undefined;
  const go = (d: string) => navigate(d === today ? `/briefs/${topicId}` : `/briefs/${topicId}/${d}`);

  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(shown));
  const firstMonth = monthOf(all.at(-1) ?? today);
  const lastMonth = monthOf(today);

  const arrow = "grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 [@media(pointer:coarse)]:size-10";

  return (
    <span className="flex items-center text-sm text-muted">
      <button className={arrow} aria-label="Previous brief" disabled={!older} onClick={() => older && go(older)}>
        <ChevronLeft className="size-4" />
      </button>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setMonth(monthOf(shown));
        }}
      >
        <Popover.Trigger className="flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 hover:bg-surface-2 hover:text-ink data-[state=open]:bg-surface-2 data-[state=open]:text-ink">
          {shown === today ? `Today · ${longDate(shown)}` : longDate(shown)}
          <CalendarDays className="size-3.5" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align="start"
            className="dialog-content z-50 w-[288px] rounded-2xl bg-surface-2 p-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-line-strong"
          >
            <div className="mb-2 flex items-center justify-between">
              <button className={arrow} aria-label="Previous month" disabled={month <= firstMonth} onClick={() => setMonth((m) => shift(m, -1))}>
                <ChevronLeft className="size-4" />
              </button>
              <span className="font-medium text-ink" aria-live="polite">
                {monthTitle.format(new Date(`${month}-01T00:00:00Z`))}
              </span>
              <button className={arrow} aria-label="Next month" disabled={month >= lastMonth} onClick={() => setMonth((m) => shift(m, 1))}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center" role="grid">
              {WEEKDAYS.map((w) => (
                <span key={w} className="pb-1 text-[11px] font-medium text-muted/70">
                  {w}
                </span>
              ))}
              {monthGrid(month).map((d, i) => {
                if (!d) return <span key={`pad-${i}`} />;
                const has = withBrief.has(d);
                const selectable = has || d === today;
                return (
                  <button
                    key={d}
                    disabled={!selectable}
                    aria-label={`${longDate(d)}${has ? " — brief available" : ""}`}
                    aria-current={d === shown ? "date" : undefined}
                    onClick={() => {
                      setOpen(false);
                      go(d);
                    }}
                    className={clsx(
                      "relative mx-auto grid size-9 place-items-center rounded-full tabular-nums transition-colors [@media(pointer:coarse)]:size-10",
                      has ? "font-bold text-accent" : selectable ? "text-ink" : "cursor-default text-muted/35",
                      selectable && d !== shown && "hover:bg-bg/60",
                      d === shown && "bg-accent/20 text-ink",
                      d === today && "ring-1 ring-line-strong",
                    )}
                  >
                    {Number(d.slice(8))}
                    {has && <span className="absolute bottom-1 size-1 rounded-full bg-accent" />}
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button className={arrow} aria-label="Next brief" disabled={!newer} onClick={() => newer && go(newer)}>
        <ChevronRight className="size-4" />
      </button>
    </span>
  );
}
