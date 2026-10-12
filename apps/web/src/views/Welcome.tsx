import { AlertTriangle, Bookmark, LayoutGrid, MessagesSquare, Plus, Rss, Sparkles, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { openSettings } from "../lib/settings-open.ts";
import { TopicDialog } from "../topics/TopicDialog.tsx";

/** "AI isn't connected yet" — on the dashboard (and welcome page) until a default model is set. */
export function AiReminder() {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-warn/10 px-4 py-3 text-sm ring-1 ring-warn/30">
      <AlertTriangle className="size-4 shrink-0 text-warn" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">AI isn't connected yet.</span> Briefs and chat need an AI model.
      </p>
      <button onClick={() => openSettings("ai")} className="min-h-9 rounded-[10px] bg-warn/20 px-3 text-sm font-medium hover:bg-warn/30">
        Connect AI
      </button>
    </div>
  );
}

const STEPS: { icon: LucideIcon; title: string; body: ReactNode }[] = [
  {
    icon: Plus,
    title: "Create a topic",
    body: (
      <>
        Topics live under <b className="text-ink">Briefs</b> in the top bar — create and edit them from the sidebar there. Describe what you care about: the angle, how technical, what to leave out.
      </>
    ),
  },
  {
    icon: Rss,
    title: "Add feeds (optional)",
    body: (
      <>
        Feeds live under <b className="text-ink">RSS</b> → <b className="text-ink">Manage feeds</b>. Tick them for a topic, or let AI pick relevant ones. Stories are found by web search either way.
      </>
    ),
  },
  { icon: LayoutGrid, title: "Read your brief", body: "Your first brief is written straight away under Briefs, then every morning: up to 15 stories, each a short sourced article." },
];

const FEATURES = [
  { icon: Bookmark, text: "Save or ignore stories — ignored ones never come back, and your ratings shape future picks." },
  { icon: MessagesSquare, text: "Chat with any article to dig deeper, grounded in its sources." },
  { icon: Rss, text: "A full RSS reader alongside, with search across everything you follow." },
] as const;

/** Dashboard when there's nothing yet (or everything was removed): what DailyBrief does and how to start. */
export function Welcome({ aiReady }: { aiReady: boolean }) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-2">
          <h1 className="flex items-center gap-2.5 text-[28px] leading-tight font-[650] tracking-[-0.02em]">
            <Sparkles className="size-6 text-accent" /> Welcome to DailyBrief
          </h1>
          <p className="text-[17px] leading-relaxed text-muted">
            Every morning DailyBrief searches the web and your RSS feeds for each topic you follow, picks the stories that matter, and writes each one up as a short, sourced article — ready before you start your day.
          </p>
        </motion.header>

        {!aiReady && <AiReminder />}

        <motion.ol initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.3 }} className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-5">
              <span className="mb-3 flex items-center gap-2 text-xs font-semibold text-accent">
                <span className="grid size-6 place-items-center rounded-full bg-accent/15 tabular-nums">{i + 1}</span>
                <Icon className="size-4" />
              </span>
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </li>
          ))}
        </motion.ol>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.16 }} className="flex justify-center">
          <button onClick={() => setCreating(true)} className="flex min-h-11 items-center gap-2 rounded-[12px] bg-accent px-6 text-sm font-semibold text-on-accent hover:brightness-110">
            <Plus className="size-4" /> Create your first topic
          </button>
        </motion.div>

        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.22 }} className="space-y-2 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
              {text}
            </li>
          ))}
        </motion.ul>
      </div>
      <TopicDialog open={creating} topicId={null} onOpenChange={setCreating} />
    </div>
  );
}
