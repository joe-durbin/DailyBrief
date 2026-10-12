import { AI_ROLES, type AiRole, type AppSettings, type ModelChoice, type ModelPriceRow, type ModelPricesReport, type PriceSource, type ProviderCheck, type ProviderKind, type ProviderSummary } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, ChevronDown, Loader2, Plus, RotateCw, Trash2, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api.ts";

const ROLE_INFO: Record<AiRole, { label: string; hint: string }> = {
  researcher: { label: "Researcher", hint: "Plans searches, groups and scores stories" },
  editor: { label: "Editor", hint: "Picks the 15 and reviews the cards" },
  writer: { label: "Writer", hint: "Writes headlines, summaries and articles" },
  chat: { label: "Chat", hint: "Answers questions about articles" },
};
export const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  openai_compatible: "OpenAI-compatible",
};
export const DEFAULT_URL: Record<ProviderKind, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
  openai_compatible: "",
};
const field = "min-h-10 w-full rounded-[10px] bg-bg/70 px-3 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";

/** Provider → model. `null` means "use default" when `emptyLabel` is set. */
function ModelPicker({ value, providers, onChange, emptyLabel }: { value: ModelChoice | null; providers: ProviderSummary[]; onChange: (c: ModelChoice | null) => void; emptyLabel?: string }) {
  const [providerId, setProviderId] = useState<number | null>(value?.providerId ?? (emptyLabel ? null : (providers[0]?.id ?? null)));
  const models = useQuery({
    queryKey: ["models", providerId],
    queryFn: () => api<string[]>(`/api/providers/${providerId}/models`),
    enabled: providerId !== null,
    staleTime: 5 * 60_000,
  });
  const pick = (model: string) => providerId !== null && model && onChange({ providerId, model });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={clsx(field, "w-auto min-w-36")}
        value={providerId ?? ""}
        onChange={(e) => {
          const id = e.target.value ? Number(e.target.value) : null;
          setProviderId(id);
          if (id === null) onChange(null);
        }}
        aria-label="Provider"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {providerId !== null && (
        <select className={clsx(field, "w-auto min-w-56 flex-1")} value={value?.providerId === providerId ? value.model : ""} onChange={(e) => pick(e.target.value)} aria-label="Model">
          <option value="" disabled>
            {models.isLoading ? "Loading models…" : models.error ? "Couldn't list models" : "Choose a model"}
          </option>
          {models.data?.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderSummary }) {
  const queryClient = useQueryClient();
  const test = useMutation({ mutationFn: () => api<ProviderCheck>(`/api/providers/${provider.id}/test`, { method: "POST" }) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ baseUrl: provider.baseUrl, apiKey: "" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["providers"] });
  const save = useMutation({
    mutationFn: () => api(`/api/providers/${provider.id}`, { method: "PATCH", body: { baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}) } }),
    onSuccess: () => {
      setEditing(false);
      setForm((f) => ({ ...f, apiKey: "" }));
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });
  const toggle = useMutation({ mutationFn: (enabled: boolean) => api(`/api/providers/${provider.id}`, { method: "PATCH", body: { enabled } }), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api(`/api/providers/${provider.id}`, { method: "DELETE" }), onSettled: refresh });
  const r = test.data;

  return (
    <div className={clsx("rounded-2xl border border-line bg-surface p-4", !provider.enabled && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {provider.name}
            <span className="ml-2 text-xs font-normal text-muted">{KIND_LABEL[provider.kind]}</span>
          </p>
          <p className="mt-0.5 truncate text-sm text-muted">{provider.baseUrl}</p>
          {!provider.hasKey && provider.kind !== "openai_compatible" && <p className="mt-0.5 text-xs text-danger">No API key set</p>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <button onClick={() => test.mutate()} disabled={test.isPending} className="flex min-h-9 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-60">
            {test.isPending && <Loader2 className="size-4 animate-spin" />}
            Test
          </button>
          <button onClick={() => setEditing((e) => !e)} className="min-h-9 rounded-[10px] px-3 text-sm text-muted ring-1 ring-line hover:text-ink">
            Edit
          </button>
          <button onClick={() => remove.mutate()} aria-label={`Remove ${provider.name}`} className="grid size-9 place-items-center rounded-[10px] text-muted ring-1 ring-line hover:text-danger">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      {r && (
        <p className={clsx("mt-3 flex items-center gap-2 text-sm", r.ok ? "text-emerald-400" : "text-danger")}>
          {r.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
          {r.ok ? `Connected · ${r.models} models` : r.error}
        </p>
      )}
      {remove.error && <p className="mt-2 text-sm text-danger">{remove.error.message}</p>}
      <PriceEditor provider={provider} />
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-2.5 border-t border-line pt-4"
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted">Base URL</span>
            <input className={field} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} inputMode="url" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">API key {provider.hasKey && "(leave blank to keep the current one)"}</span>
            <input className={field} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={provider.hasKey ? "••••••••" : ""} />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={provider.enabled} onChange={(e) => toggle.mutate(e.target.checked)} className="size-4 accent-accent" /> Enabled
            </label>
            <button disabled={save.isPending} className="min-h-9 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-60">
              Save
            </button>
          </div>
          {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
        </form>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<PriceSource, string> = { catalogue: "LiteLLM list", openrouter: "OpenRouter", provider: "From provider", manual: "Set by you" };

/**
 * Prices for every model this provider offers, looked up automatically (catalogue / OpenRouter / provider) and
 * editable: an edited price is kept as yours until reset. Unknown prices show "—". Each call is costed when it's made.
 */
function PriceEditor({ provider }: { provider: ProviderSummary }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ["model-prices", provider.id];
  const report = useQuery({
    queryKey: key,
    queryFn: () => api<ModelPricesReport>(`/api/providers/${provider.id}/prices`),
    enabled: open && provider.enabled,
    retry: false,
    // While a lookup runs, poll until it finishes.
    refetchInterval: (q) => (q.state.data?.refreshing ? 2_000 : false),
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["model-prices"] });
  const refresh = useMutation({ mutationFn: () => api("/api/model-prices/refresh", { method: "POST" }), onSuccess: reload });
  const rows = report.data?.prices ?? [];
  const unknown = rows.filter((r) => r.input === null).length;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
        Prices
        {report.data && <span>· {unknown ? `${rows.length - unknown} of ${rows.length} known` : `${rows.length} models`}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-md text-xs text-muted">
              Pricing data for available models will be fetched where possible. Prices may not be accurate — edit any you know better (US dollars per million tokens).
            </p>
            <button
              onClick={() => refresh.mutate()}
              disabled={report.data?.refreshing || refresh.isPending}
              className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted ring-1 ring-line hover:text-ink disabled:opacity-60"
            >
              <RotateCw className={clsx("size-3.5", report.data?.refreshing && "animate-spin")} />
              {report.data?.refreshing ? "Looking up…" : "Refresh prices"}
            </button>
          </div>
          {report.isLoading && <p className="px-1 text-sm text-muted">Loading…</p>}
          {report.error && <p className="px-1 text-sm text-danger">{report.error.message}</p>}
          {rows.length > 0 && (
            <div className={clsx(PRICE_GRID, "px-1 text-[11px] font-semibold tracking-wide text-muted uppercase")}>
              <span>Model</span>
              <span className="text-right">Input</span>
              <span className="text-right">Output</span>
              <span>Source</span>
            </div>
          )}
          {rows.map((r) => (
            <PriceRow key={r.model} row={r} looking={!!report.data?.refreshing} onSaved={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

const PRICE_GRID = "grid grid-cols-[minmax(0,1fr)_6rem_6rem_7.5rem] items-center gap-2";
const asText = (n: number | null) => (n === null ? "" : String(n));

function PriceRow({ row, looking, onSaved }: { row: ModelPriceRow; looking: boolean; onSaved: () => Promise<unknown> }) {
  const [input, setInput] = useState(asText(row.input));
  const [output, setOutput] = useState(asText(row.output));
  // Follow lookups that change the stored price (unless the reader is mid-edit).
  const [seen, setSeen] = useState(row);
  if (seen.input !== row.input || seen.output !== row.output) {
    setSeen(row);
    setInput(asText(row.input));
    setOutput(asText(row.output));
  }
  const parsed = (v: string) => (v.trim() === "" ? null : Number(v));
  const valid = (v: string) => parsed(v) !== null && Number.isFinite(parsed(v)) && (parsed(v) ?? -1) >= 0;
  const dirty = input !== asText(row.input) || output !== asText(row.output);
  const save = useMutation({
    mutationFn: () => api("/api/model-prices", { method: "PUT", body: { model: row.model, input: Number(input), output: Number(output) } }),
    onSuccess: onSaved,
  });
  const reset = useMutation({ mutationFn: () => api("/api/model-prices/reset", { body: { model: row.model } }), onSuccess: onSaved });
  const money = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="flex items-center gap-1 rounded-[10px] bg-bg/70 px-2.5 ring-1 ring-line focus-within:ring-accent/60">
      <span className="text-sm text-muted">$</span>
      <input className="min-h-9 w-full min-w-0 bg-transparent text-right text-base tabular-nums outline-none placeholder:text-muted/60" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder="—" />
    </label>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && valid(input) && valid(output)) save.mutate();
      }}
      className={clsx(PRICE_GRID, "rounded-lg px-1 py-0.5 hover:bg-bg/40")}
    >
      <span className="truncate text-sm" title={row.model}>
        {row.model}
      </span>
      {money(input, setInput, `${row.model} input price per million tokens`)}
      {money(output, setOutput, `${row.model} output price per million tokens`)}
      {dirty ? (
        <button disabled={!valid(input) || !valid(output) || save.isPending} className="min-h-8 rounded-lg bg-accent px-2.5 text-xs font-semibold text-on-accent disabled:opacity-40">
          Save
        </button>
      ) : row.source === "manual" ? (
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {SOURCE_LABEL.manual}
          <button type="button" onClick={() => reset.mutate()} title="Look the price up automatically again" className="text-accent hover:underline">
            reset
          </button>
        </span>
      ) : (
        <span className="truncate text-xs text-muted" title={row.checkedAt ? `Checked ${new Date(row.checkedAt).toLocaleString("en-GB")}` : undefined}>
          {row.source ? SOURCE_LABEL[row.source] : looking ? "Looking up…" : row.checkedAt ? "Not found" : "Not checked yet"}
        </span>
      )}
    </form>
  );
}

function AddProvider({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ kind: "openai" as ProviderKind, name: "", baseUrl: DEFAULT_URL.openai, apiKey: "" });
  const add = useMutation({
    mutationFn: () => api("/api/providers", { body: { ...form, name: form.name || KIND_LABEL[form.kind] } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
      onDone();
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={onSubmit} className="space-y-2.5 rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm font-medium">Add a provider</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <select
          className={field}
          value={form.kind}
          onChange={(e) => {
            const kind = e.target.value as ProviderKind;
            setForm({ ...form, kind, baseUrl: DEFAULT_URL[kind] });
          }}
          aria-label="Provider type"
        >
          {(Object.keys(DEFAULT_URL) as ProviderKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <input className={field} placeholder={`Name (e.g. ${KIND_LABEL[form.kind]} API)`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} />
      </div>
      <input className={field} placeholder="Base URL (e.g. http://ollama.local:11434/v1 for Ollama)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} inputMode="url" required />
      <input className={field} type="password" autoComplete="off" placeholder={form.kind === "openai_compatible" ? "API key (if required)" : "API key"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required={form.kind !== "openai_compatible"} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="min-h-9 rounded-[10px] px-3 text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <button disabled={add.isPending} className="min-h-9 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-60">
          Add provider
        </button>
      </div>
      {add.error && <p className="text-sm text-danger">{add.error.message}</p>}
      <p className="text-xs text-muted">API keys are encrypted on the server and never sent back to the browser.</p>
    </form>
  );
}

export function AiTab() {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderSummary[]>("/api/providers") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings") });
  const [showRoles, setShowRoles] = useState(false);
  const [adding, setAdding] = useState(false);
  const save = useMutation({
    mutationFn: (ai: Partial<AppSettings["ai"]>) => api<AppSettings>("/api/settings", { method: "PUT", body: { ai } }),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });
  const list = providers.data?.filter((p) => p.enabled) ?? [];
  const ai = settings.data?.ai;
  if (!ai || !providers.data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-7">
      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Default model</h3>
        <p className="mb-3 text-sm text-muted">Used for every step unless a role below overrides it.</p>
        <ModelPicker value={ai.default} providers={list} onChange={(c) => c && save.mutate({ default: c })} />
        {save.isSuccess && !save.isPending && <p className="mt-2 text-xs text-emerald-400">Saved — applies from the next AI call.</p>}
        {save.error && <p className="mt-2 text-sm text-danger">{save.error.message}</p>}
      </section>

      <section>
        <button onClick={() => setShowRoles((s) => !s)} className="flex min-h-9 items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase hover:text-ink">
          Customise per role <ChevronDown className={clsx("size-3.5 transition-transform", showRoles && "rotate-180")} />
        </button>
        {showRoles && (
          <div className="mt-3 space-y-4">
            {AI_ROLES.map((role) => (
              <div key={role} className="space-y-1.5">
                <p className="text-sm">
                  {ROLE_INFO[role].label} <span className="text-xs text-muted">· {ROLE_INFO[role].hint}</span>
                </p>
                <ModelPicker
                  value={ai.roles[role] ?? null}
                  providers={list}
                  emptyLabel="Use default"
                  onChange={(c) => {
                    const roles = { ...ai.roles };
                    if (c) roles[role] = c;
                    else delete roles[role];
                    save.mutate({ roles });
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Providers</h3>
          {!adding && (
            <button onClick={() => setAdding(true)} className="flex min-h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm text-muted ring-1 ring-line hover:text-ink">
              <Plus className="size-4" /> Add provider
            </button>
          )}
        </div>
        <div className="space-y-3">
          {adding && <AddProvider onDone={() => setAdding(false)} />}
          {providers.data.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
