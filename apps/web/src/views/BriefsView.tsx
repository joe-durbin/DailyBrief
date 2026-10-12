import type { Topic } from "@dailybrief/shared";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Navigate, useParams } from "react-router";
import { api } from "../api.ts";
import { BriefPane } from "../briefs/BriefPane.tsx";
import { TopicSidebar } from "../shell/TopicSidebar.tsx";
import { TopicDialog } from "../topics/TopicDialog.tsx";
import { LayoutGrid } from "lucide-react";

export function BriefsView() {
  const { topicId, date } = useParams();
  const pastDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const topics = useQuery({ queryKey: ["topics"], queryFn: () => api<Topic[]>("/api/topics") });
  if (!topics.data) return null;

  const first = topics.data[0];
  const current = topics.data.find((t) => String(t.id) === topicId);
  if (!current) return first ? <Navigate to={`/briefs/${first.id}`} replace /> : <NoTopics />;
  return (
    <div className="flex h-full">
      <TopicSidebar topics={topics.data} drawerOpen={drawerOpen} onDrawerChange={setDrawerOpen} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${current.id}-${pastDate ?? "today"}`} className="flex min-w-0 flex-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <BriefPane topic={current} date={pastDate} onOpenTopics={() => setDrawerOpen(true)} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Briefs with no topics yet: one button to create the first. */
function NoTopics() {
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <LayoutGrid className="size-7 text-muted" />
        <p className="font-semibold">No topics yet</p>
        <p className="text-sm text-muted">Each topic gets its own daily brief. Create one to get started.</p>
        <button onClick={() => setCreating(true)} className="mt-2 min-h-10 rounded-[10px] bg-accent px-5 text-sm font-semibold text-on-accent hover:brightness-110">
          Create a topic
        </button>
      </div>
      <TopicDialog open={creating} topicId={null} onOpenChange={setCreating} />
    </div>
  );
}
