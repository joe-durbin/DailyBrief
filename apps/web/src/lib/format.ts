const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/** "8 hours ago" relative to `now` — pass `useNow()` so the label keeps up while the page is open. */
export function timeAgo(ms: number | null, now: number): string {
  if (ms === null) return "";
  const minutes = Math.round((ms - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

/** Local calendar date (YYYY-MM-DD) of `ms`. */
export function isoDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${isoDate}T12:00:00`));
}

export function shortDate(ms: number | null): string {
  return ms === null ? "" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
}

/** US dollars for AI spend: cents precision, with very small amounts shown as "<$0.01". */
export function usd(amount: number): string {
  if (amount > 0 && amount < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
