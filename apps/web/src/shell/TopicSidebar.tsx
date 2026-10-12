import type { Topic } from "@dailybrief/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, GripVertical, Loader2, PanelLeftOpen, Pencil, Plus, X } from "lucide-react";
import { motion, Reorder, useDragControls } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { api } from "../api.ts";
import { TopicDialog } from "../topics/TopicDialog.tsx";
import { IconButton } from "../ui/IconButton.tsx";

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function Badge({ topic }: { topic: Topic }) {
  if (topic.generating) return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" aria-label="Generating" />;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {topic.warning && <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-label={`Brief problem: ${topic.warning}`} />}
      {topic.remaining > 0 && (
        <span className="min-w-5 shrink-0 rounded-full bg-bg/70 px-1.5 text-center text-[11px] leading-5 font-semibold text-muted tabular-nums">{topic.remaining}</span>
      )}
    </span>
  );
}

function TopicLinks({ topics, layoutKey, onNavigate }: { topics: Topic[]; layoutKey: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Topics">
      {topics.map((t) => (
        <NavLink
          key={t.id}
          to={`/briefs/${t.id}`}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx("relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors", isActive ? "text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink")
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId={layoutKey} className="absolute inset-0 rounded-xl bg-surface-2 ring-1 ring-line" transition={{ type: "spring", bounce: 0, duration: 0.3 }} />}
              <span className="relative size-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.accent }} />
              <span className="relative min-w-0 flex-1 truncate">{t.name}</span>
              <span className="relative">
                <Badge topic={t} />
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Edit mode: drag to reorder (mouse or touch), pencil to edit, add a new topic. */
function EditableTopics({ topics, onEdit }: { topics: Topic[]; onEdit: (id: number | null) => void }) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(topics);
  useEffect(() => setOrder(topics), [topics]);
  const saveOrder = useMutation({
    mutationFn: (ids: number[]) => api("/api/topics/order", { method: "PUT", body: { ids } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["topics"] }),
  });
  return (
    <div className="flex flex-col gap-1 p-3">
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-1">
        {order.map((t) => (
          <EditableRow key={t.id} topic={t} onEdit={() => onEdit(t.id)} onDrop={() => saveOrder.mutate(order.map((x) => x.id))} />
        ))}
      </Reorder.Group>
      <button onClick={() => onEdit(null)} className="mt-1 flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 text-sm text-muted hover:text-ink">
        <Plus className="size-4" /> Add topic
      </button>
    </div>
  );
}

function EditableRow({ topic, onEdit, onDrop }: { topic: Topic; onEdit: () => void; onDrop: () => void }) {
  const drag = useDragControls();
  return (
    <Reorder.Item value={topic} dragListener={false} dragControls={drag} onDragEnd={onDrop} className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-2/60 pr-1 pl-1 ring-1 ring-line">
      <button
        aria-label={`Drag to reorder ${topic.name}`}
        onPointerDown={(e) => drag.start(e)}
        className="grid size-9 shrink-0 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: topic.accent }} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{topic.name}</span>
      <IconButton icon={Pencil} label={`Edit ${topic.name}`} onClick={onEdit} />
    </Reorder.Item>
  );
}

/** Topic list plus the Edit / Done toggle pinned to the bottom. */
function TopicPanel({ topics, layoutKey, onNavigate, onEdit }: { topics: Topic[]; layoutKey: string; onNavigate?: () => void; onEdit: (id: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing ? <EditableTopics topics={topics} onEdit={onEdit} /> : <TopicLinks topics={topics} layoutKey={layoutKey} onNavigate={onNavigate} />}
      </div>
      <div className="border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setEditing((e) => !e)}
          className={clsx("flex min-h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors", editing ? "bg-accent text-on-accent" : "text-muted ring-1 ring-line hover:text-ink")}
        >
          {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
          {editing ? "Done" : "Edit topics"}
        </button>
      </div>
    </div>
  );
}

/**
 * ≥1280px: full sidebar with names. 900–1279px (e.g. iPad landscape): 72px rail of monograms that opens a drawer.
 * <900px: hidden; the brief header's Topics button opens the same drawer.
 */
export function TopicSidebar({ topics, drawerOpen, onDrawerChange }: { topics: Topic[]; drawerOpen: boolean; onDrawerChange: (open: boolean) => void }) {
  const [dialog, setDialog] = useState<{ open: boolean; topicId: number | null }>({ open: false, topicId: null });
  const openEditor = (topicId: number | null) => setDialog({ open: true, topicId });
  return (
    <>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface xl:flex">
        <TopicPanel topics={topics} layoutKey="topic-highlight" onEdit={openEditor} />
      </aside>
      <TopicDialog open={dialog.open} topicId={dialog.topicId} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />

      <aside className="hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-line bg-surface py-3 min-[900px]:flex xl:hidden">
        <IconButton icon={PanelLeftOpen} label="Show topics" onClick={() => onDrawerChange(true)} />
        <span className="h-px w-8 bg-line" />
        {topics.map((t) => (
          <NavLink
            key={t.id}
            to={`/briefs/${t.id}`}
            title={t.name}
            aria-label={t.name}
            className={({ isActive }) =>
              clsx("relative grid size-11 place-items-center rounded-xl text-[13px] font-semibold transition-colors", isActive ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:bg-surface-2/60")
            }
          >
            <span className="grid size-8 place-items-center rounded-full ring-2" style={{ boxShadow: `inset 0 0 0 2px ${t.accent}` }}>
              {monogram(t.name)}
            </span>
            {(t.generating || t.remaining > 0) && (
              <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-surface-2 px-1 text-[10px] leading-5 font-semibold text-muted ring-1 ring-line">
                {t.generating ? <Loader2 className="size-3 animate-spin" /> : t.remaining}
              </span>
            )}
            {t.warning && !t.generating && (
              <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-surface-2 ring-1 ring-warn/40" aria-label={`Brief problem: ${t.warning}`}>
                <AlertTriangle className="size-3 text-warn" />
              </span>
            )}
          </NavLink>
        ))}
      </aside>

      <Dialog.Root open={drawerOpen} onOpenChange={onDrawerChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
          <Dialog.Content asChild>
            <motion.div
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-surface pt-[env(safe-area-inset-top)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none"
            >
              <div className="flex items-center justify-between px-4 pt-3">
                <Dialog.Title className="text-sm font-semibold">Topics</Dialog.Title>
                <Dialog.Description className="sr-only">Choose a topic</Dialog.Description>
                <Dialog.Close asChild>
                  <IconButton icon={X} label="Close" />
                </Dialog.Close>
              </div>
              <TopicPanel topics={topics} layoutKey="topic-highlight-drawer" onNavigate={() => onDrawerChange(false)} onEdit={openEditor} />
            </motion.div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
