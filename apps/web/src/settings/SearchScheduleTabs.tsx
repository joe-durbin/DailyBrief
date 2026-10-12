import { FEED_INTERVALS, SEARCH_PROVIDERS, type AppSettings, type Schedule, type SearchProvider } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";

const field = "min-h-10 w-full rounded-[10px] bg-bg/70 px-3 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";
const SEARCH_INFO: Record<SearchProvider, { label: string; note: string }> = {
  searxng: { label: "SearXNG", note: "Built in, no key needed. Meta-search across public engines." },
  brave: { label: "Brave Search", note: "Strong news coverage. Needs a Brave Search API key." },
  tavily: { label: "Tavily", note: "Search built for AI agents. Needs a Tavily API key." },
  exa: { label: "Exa", note: "Neural search, good for research blogs. Needs an Exa API key." },
};

function useSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings") });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<AppSettings>("/api/settings", { method: "PUT", body: patch }),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });
  return { settings, save };
}

export function SearchTab() {
  const { settings, save } = useSettings();
  const current = settings.data?.search;
  const [provider, setProvider] = useState<SearchProvider>("searxng");
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    if (current) setProvider(current.provider);
  }, [current]);
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; results: number; sample?: string | null; error?: string }>("/api/settings/search/test", { body: { provider, ...(apiKey ? { apiKey } : {}) } }),
  });
  if (!current) return <p className="text-sm text-muted">Loading…</p>;
  const needsKey = provider !== "searxng";
  const keyStored = current.provider === provider && current.hasKey;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Web search</h3>
        <p className="text-sm text-muted">Used to find stories for briefs and for "Look further" in article chat. RSS feeds are always used as well.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Search provider">
        {SEARCH_PROVIDERS.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={provider === p}
            onClick={() => {
              setProvider(p);
              setApiKey("");
              test.reset();
            }}
            className={clsx("rounded-2xl border p-3.5 text-left transition-colors", provider === p ? "border-accent/60 bg-accent/10" : "border-line bg-surface hover:border-line-strong")}
          >
            <span className="block text-sm font-medium">{SEARCH_INFO[p].label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">{SEARCH_INFO[p].note}</span>
          </button>
        ))}
      </div>
      {needsKey && (
        <input className={field} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyStored ? "•••••••• (leave blank to keep)" : `${SEARCH_INFO[provider].label} API key`} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => test.mutate()} disabled={test.isPending || (needsKey && !apiKey && !keyStored)} className="flex min-h-10 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-sm font-medium disabled:opacity-50">
          {test.isPending && <Loader2 className="size-4 animate-spin" />}
          Test
        </button>
        <button
          onClick={() => save.mutate({ search: { provider, ...(apiKey ? { apiKey } : {}) } })}
          disabled={save.isPending || (needsKey && !apiKey && !keyStored)}
          className="min-h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50"
        >
          Save
        </button>
        {current.provider === provider && !apiKey && <span className="text-xs text-muted">In use</span>}
      </div>
      {test.data && (
        <p className={clsx("flex items-center gap-2 text-sm", test.data.ok ? "text-emerald-400" : "text-danger")}>
          {test.data.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
          {test.data.ok ? `${test.data.results} results · e.g. “${test.data.sample}”` : (test.data.error ?? "No results")}
        </p>
      )}
      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
    </div>
  );
}

export function ScheduleTab() {
  const { settings, save } = useSettings();
  const [form, setForm] = useState<Schedule | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data.schedule);
  }, [settings.data]);
  const runAll = useMutation({ mutationFn: () => api<{ queued: number }>("/api/settings/run-all", { method: "POST" }) });
  const zones = Intl.supportedValuesOf("timeZone");
  if (!form) return <p className="text-sm text-muted">Loading…</p>;
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.data?.schedule);

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Daily brief</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Time</span>
            <input type="time" className={field} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Timezone</span>
            <select className={field} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted">Check RSS feeds every</span>
          <select className={field} value={form.feedMinutes} onChange={(e) => setForm({ ...form, feedMinutes: Number(e.target.value) as Schedule["feedMinutes"] })}>
            {FEED_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? "hour" : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted">If DailyBrief isn't running at brief time (or the machine is asleep), it catches up as soon as it's back.</p>
        <button onClick={() => save.mutate({ schedule: form })} disabled={!dirty || save.isPending} className="min-h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-50">
          Save schedule
        </button>
        {save.isSuccess && !dirty && <p className="text-xs text-emerald-400">Saved — the next brief is scheduled for {form.time} ({form.timezone}).</p>}
        {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      </section>

      <section className="space-y-2 border-t border-line pt-6">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Run all now</h3>
        <p className="text-sm text-muted">Regenerate today's brief for every topic. Unsaved cards are replaced; saved and ignored stories are kept.</p>
        <button onClick={() => runAll.mutate()} disabled={runAll.isPending} className="min-h-10 rounded-[10px] border border-line-strong px-4 text-sm font-medium disabled:opacity-50">
          Regenerate all topics
        </button>
        {runAll.data && <p className="text-xs text-muted">{runAll.data.queued ? `${runAll.data.queued} topic(s) queued — watch the sidebar.` : "Already generating."}</p>}
      </section>
    </div>
  );
}

export function RssTab() {
  const { settings, save } = useSettings();
  const current = settings.data?.rss.inactiveDays;
  const [days, setDays] = useState("");
  useEffect(() => {
    if (current !== undefined) setDays(String(current));
  }, [current]);
  if (current === undefined) return <p className="text-sm text-muted">Loading…</p>;
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 7 && n <= 365;

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Quiet feeds</h3>
      <p className="mb-3 text-sm text-muted">When a feed hasn't posted for this many days, the dashboard asks whether to remove it.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate({ rss: { inactiveDays: n } });
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="flex items-center gap-2 text-sm">
          <input className="min-h-10 w-24 rounded-[10px] bg-bg/70 px-3 text-right text-base text-ink tabular-nums ring-1 ring-line outline-none focus:ring-accent/60" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} aria-label="Days without a post" />
          days without a post
        </label>
        <button disabled={!valid || n === current || save.isPending} className="min-h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-40">
          Save
        </button>
        {save.isSuccess && n === current && <span className="text-sm text-muted">Saved</span>}
      </form>
      {!valid && days !== "" && <p className="mt-2 text-sm text-danger">Choose between 7 and 365 days.</p>}
      {save.error && <p className="mt-2 text-sm text-danger">{save.error.message}</p>}
      <p className="mt-3 text-xs text-muted">Default 30. How often feeds are checked is under Schedule.</p>
    </section>
  );
}
