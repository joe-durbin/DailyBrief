import type { AgentsSettings, AppSettings } from "@dailybrief/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useRef, useState } from "react";
import { api } from "../api.ts";

type AgentRole = keyof AgentsSettings;
type Choice<R extends AgentRole> = { value: AgentsSettings[R]; label: string; description: string };

const RESEARCHER_CHOICES: Choice<"researcher">[] = [
  { value: "quick", label: "Quick", description: "Use the first 300 characters of each source. Fastest, with less context." },
  { value: "balanced", label: "Balanced", description: "Use the opening excerpt and relevant passages from throughout each source." },
  { value: "deep", label: "Deep", description: "Balanced research plus summaries of up to 12 substantial, relevant sources per pass, in batches of up to four. This uses extra AI calls and takes longer." },
];
const WRITER_CHOICES: Choice<"writer">[] = [
  { value: "concise", label: "Concise", description: "Shorter articles that get to the point." },
  { value: "standard", label: "Standard", description: "The usual article length and level of detail." },
  { value: "detailed", label: "Detailed", description: "Longer articles with more explanation. This will use more tokens." },
];
const CHAT_CHOICES: Choice<"chat">[] = [
  { value: "brief", label: "Brief", description: "Short, direct answers. Uses fewer output tokens." },
  { value: "standard", label: "Standard", description: "The usual conversational answers." },
  { value: "detailed", label: "Detailed", description: "More thorough answers. This will use more tokens." },
];

function Choices<R extends AgentRole>({ role, value, options, onChange }: { role: R; value: AgentsSettings[R]; options: Choice<R>[]; onChange: (value: AgentsSettings[R]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <label key={option.value} className="cursor-pointer">
          <input className="peer sr-only" type="radio" name={`agent-${role}`} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span className={clsx("flex h-full flex-col gap-1 rounded-xl border p-3 text-left transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent", value === option.value ? "border-accent/60 bg-accent/10" : "border-line bg-surface hover:border-line-strong")}>
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs leading-snug text-muted">{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function AgentsTab() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings") });
  const [draft, setDraft] = useState<AgentsSettings | null>(null);
  // The ref is updated synchronously so a second choice uses the first choice even before React re-renders.
  const draftRef = useRef<AgentsSettings | null>(null);
  const save = useMutation({
    scope: { id: "agents-settings" },
    mutationFn: (agents: AgentsSettings) => api<AppSettings>("/api/settings", { method: "PUT", body: { agents } }),
    onSuccess: (data, submitted) => {
      queryClient.setQueryData(["settings"], data);
      if (draftRef.current === submitted) {
        draftRef.current = null;
        setDraft(null);
      }
    },
    onError: (_error, submitted) => {
      if (draftRef.current === submitted) {
        draftRef.current = null;
        setDraft(null);
      }
    },
  });
  const current = draft ?? settings.data?.agents;
  const pick = <R extends AgentRole>(role: R, value: AgentsSettings[R]) => {
    const previous = draftRef.current ?? settings.data?.agents;
    if (!previous || previous[role] === value) return;
    const next = { ...previous, [role]: value };
    draftRef.current = next;
    setDraft(next);
    save.mutate(next);
  };

  if (settings.isPending) return <p className="text-sm text-muted">Loading agent settings…</p>;
  if (settings.isError || !current) return <p role="alert" className="text-sm text-danger">Could not load agent settings: {settings.error?.message ?? "Please try again."}</p>;

  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-base font-semibold">Agent behaviour</h2>
        <p className="mt-1 text-sm text-muted">Choose how each agent works. Choose their models separately under the AI heading. Changes to briefs apply from the next generation. Chat changes apply to the next answer.</p>
        <p aria-live="polite" className="mt-2 text-xs text-muted">
          {save.isPending ? "Saving agent settings…" : save.isSuccess ? "Saved." : "Selections save automatically."}
        </p>
        {save.isError && <p role="alert" className="mt-1 text-sm text-danger">Could not save agent settings: {save.error.message}</p>}
      </div>
      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Researcher</legend>
        <p className="mb-3 mt-1 text-sm text-muted">The researcher plans searches from your topic description, gathers recent coverage from the web and linked RSS feeds, and reads the source material. It groups reports about the same event, weighs their relevance, significance, freshness and source quality, and passes the promising stories to the editor.</p>
        <Choices role="researcher" value={current.researcher} options={RESEARCHER_CHOICES} onChange={(value) => pick("researcher", value)} />
      </fieldset>
      <section>
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Editor</h3>
        <p className="mt-1 text-sm text-muted">The editor chooses which researched stories deserve a place in the brief, balancing importance and variety rather than repeating the same event. After the writer drafts them, it reviews the finished set and can request revisions or replacements for weak or duplicate articles. There is currently no behaviour setting for the editor.</p>
      </section>
      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Writer</legend>
        <p className="mb-3 mt-1 text-sm text-muted">The writer turns each selected story into an article with a headline, short summary and readable explanation. It works from the gathered sources, cites them alongside its claims, and focuses on what happened, why it matters and what remains unclear. Article length can be adjusted below.</p>
        <Choices role="writer" value={current.writer} options={WRITER_CHOICES} onChange={(value) => pick("writer", value)} />
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Chat</legend>
        <p className="mb-3 mt-1 text-sm text-muted">Chat answers your follow-up questions about an article using the article and its sources, with citations so you can check the evidence. It remembers the recent conversation, and Look further can bring in relevant web results when you choose it. The setting below changes how much detail answers usually include.</p>
        <Choices role="chat" value={current.chat} options={CHAT_CHOICES} onChange={(value) => pick("chat", value)} />
      </fieldset>
    </div>
  );
}
