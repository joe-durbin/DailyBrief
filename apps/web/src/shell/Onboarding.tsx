import type { AppSettings, ConnectionTest, ProviderKind, ProviderSummary } from "@dailybrief/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { DEFAULT_URL, KIND_LABEL } from "../settings/AiTab.tsx";
import { BriefFillSetting, ThemeSetting } from "../settings/SettingsDialog.tsx";

const field = "min-h-10 w-full rounded-[10px] bg-bg/70 px-3 text-base text-ink ring-1 ring-line outline-none focus:ring-accent/60";
/** Example address for an OpenAI-compatible endpoint (proxy or local model server). */
const PROXY_EXAMPLE = "https://ai.provider.com:1234/v1";

/**
 * First-run setup after the account is created: 1) look & feel, 2) connect an AI provider (or skip). Shown once:
 * finishing or skipping stores `onboarding.done`.
 */
export function Onboarding() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings") });
  const [step, setStep] = useState<"look" | "ai">("look");
  const finish = useMutation({
    mutationFn: () => api<AppSettings>("/api/settings", { method: "PUT", body: { onboarded: true } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
      return Promise.all(["dashboard", "providers"].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
    },
  });
  /** New installs have no timezone of their own: use this browser's, so briefs arrive at 05:00 local time. */
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const saveTimezone = useMutation({
    mutationFn: (schedule: AppSettings["schedule"]) => api<AppSettings>("/api/settings", { method: "PUT", body: { schedule: { ...schedule, timezone } } }),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });
  if (!settings.data || settings.data.onboarded) return null;
  const { schedule } = settings.data;

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px]" />
        <Dialog.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="dialog-content fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[20px] border border-line bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none"
        >
          <div className="flex items-center gap-3 border-b border-line px-6 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold tracking-tight">{step === "look" ? "Make it yours" : "Connect your AI"}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                {step === "look" ? "Pick a look and how full each daily brief should be. You can change both later in Settings." : "DailyBrief uses an AI model to research and write your briefs."}
              </Dialog.Description>
            </div>
            <span className="shrink-0 text-xs text-muted tabular-nums">Step {step === "look" ? 1 : 2} of 2</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {step === "look" ? (
                <>
                  <div className="space-y-6 p-6">
                    <ThemeSetting />
                    <BriefFillSetting enabled />
                    <p className="text-sm text-muted">
                      New briefs are written every day at <b className="text-ink">{schedule.time}</b>, <b className="text-ink">{timezone.replaceAll("_", " ")}</b> time (this device's timezone). Change it in Settings → Schedule.
                    </p>
                  </div>
                  <div className="flex justify-end border-t border-line px-6 py-4">
                    <button
                      onClick={() => {
                        if (schedule.timezone !== timezone) saveTimezone.mutate(schedule);
                        setStep("ai");
                      }}
                      className="min-h-10 rounded-[10px] bg-accent px-5 text-sm font-semibold text-on-accent hover:brightness-110"
                    >
                      Continue
                    </button>
                  </div>
                </>
              ) : (
                <ConnectAi defaultModel={settings.data.ai.default} onBack={() => setStep("look")} onDone={() => finish.mutate()} finishing={finish.isPending} />
              )}
            </motion.div>
          </AnimatePresence>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConnectAi({ defaultModel, onBack, onDone, finishing }: { defaultModel: AppSettings["ai"]["default"]; onBack: () => void; onDone: () => void; finishing: boolean }) {
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api<ProviderSummary[]>("/api/providers") });
  // A new install has no provider: the form starts blank. If one was already saved (e.g. setup was left part-way), it's offered again.
  const existing = providers.data?.[0];
  const [form, setForm] = useState({ kind: "openai_compatible" as ProviderKind, name: "", baseUrl: "", apiKey: "" });
  const [model, setModel] = useState("");
  useEffect(() => {
    if (existing) setForm({ kind: existing.kind, name: existing.name, baseUrl: existing.baseUrl, apiKey: "" });
  }, [existing]);
  const usingExisting = existing !== undefined && form.kind === existing.kind;

  const test = useMutation({
    mutationFn: () =>
      api<ConnectionTest>("/api/providers/test-connection", {
        body: { kind: form.kind, baseUrl: form.baseUrl, ...(form.apiKey ? { apiKey: form.apiKey } : {}), ...(usingExisting ? { providerId: existing.id } : {}) },
      }),
    onSuccess: (r) => {
      if (!r.ok) return;
      const keep = defaultModel && r.models.includes(defaultModel.model) ? defaultModel.model : undefined;
      setModel(keep ?? r.models[0] ?? "");
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      let providerId: number;
      if (usingExisting) {
        await api(`/api/providers/${existing.id}`, { method: "PATCH", body: { name: form.name || existing.name, baseUrl: form.baseUrl, enabled: true, ...(form.apiKey ? { apiKey: form.apiKey } : {}) } });
        providerId = existing.id;
      } else {
        providerId = (await api<{ id: number }>("/api/providers", { body: { kind: form.kind, name: form.name || KIND_LABEL[form.kind], baseUrl: form.baseUrl, apiKey: form.apiKey } })).id;
      }
      await api("/api/settings", { method: "PUT", body: { ai: { default: { providerId, model } } } });
    },
    onSuccess: onDone,
  });
  const edit = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    test.reset();
  };
  const r = test.data;
  const needsKey = form.kind !== "openai_compatible";
  const keyStored = usingExisting && existing.hasKey;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          test.mutate();
        }}
        className="space-y-4 p-6"
      >
        <p className="text-sm text-muted">
          Use <b className="text-ink">OpenAI-compatible</b> for a LiteLLM proxy or a local model server (address usually ends in <code>/v1</code>), or connect a provider directly with its API key.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Provider type</span>
            <select
              className={field}
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as ProviderKind;
                edit({ kind, baseUrl: DEFAULT_URL[kind] });
              }}
            >
              {(Object.keys(DEFAULT_URL) as ProviderKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Name</span>
            <input className={field} value={form.name} onChange={(e) => edit({ name: e.target.value })} maxLength={60} placeholder={form.kind === "openai_compatible" ? "e.g. LiteLLM" : KIND_LABEL[form.kind]} />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Address</span>
          <input
            className={field}
            value={form.baseUrl}
            onChange={(e) => edit({ baseUrl: e.target.value })}
            inputMode="url"
            required
            placeholder={form.kind === "openai_compatible" ? `e.g. ${PROXY_EXAMPLE}` : DEFAULT_URL[form.kind]}
          />
          {form.kind === "openai_compatible" && <span className="block text-xs text-muted">DailyBrief runs in Docker: for a proxy on this machine use host.docker.internal, not localhost.</span>}
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">API key {needsKey ? "" : "(if your proxy needs one)"}</span>
          <input
            className={field}
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onChange={(e) => edit({ apiKey: e.target.value })}
            placeholder={keyStored ? "Stored — leave blank to keep it" : ""}
            required={needsKey && !keyStored}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={test.isPending || !form.baseUrl} className="flex min-h-10 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold ring-1 ring-line-strong hover:bg-surface disabled:opacity-60">
            {test.isPending && <Loader2 className="size-4 animate-spin" />}
            Test connection
          </button>
          {r && (
            <span className={clsx("flex items-center gap-1.5 text-sm", r.ok ? "text-emerald-400" : "text-danger")}>
              {r.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
              {r.ok ? `Connected · ${r.models.length} models` : r.error}
            </span>
          )}
          {test.error && <span className="text-sm text-danger">{test.error.message}</span>}
        </div>
        {r?.ok && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted">Default model — used for researching, writing and chat (per-step models can be set later in Settings → AI)</span>
            <select className={field} value={model} onChange={(e) => setModel(e.target.value)}>
              {r.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      </form>
      <div className="flex items-center gap-2 border-t border-line px-6 py-4">
        <button onClick={onBack} className="min-h-10 rounded-[10px] px-3 text-sm text-muted hover:text-ink">
          Back
        </button>
        <button onClick={onDone} disabled={finishing} className="ml-auto min-h-10 rounded-[10px] px-3 text-sm text-muted hover:text-ink">
          Skip for now
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={!r?.ok || !model || save.isPending || finishing}
          className="flex min-h-10 items-center gap-2 rounded-[10px] bg-accent px-5 text-sm font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
        >
          {(save.isPending || finishing) && <Loader2 className="size-4 animate-spin" />}
          Finish
        </button>
      </div>
    </>
  );
}
