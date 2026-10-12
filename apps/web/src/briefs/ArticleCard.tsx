import type { ArticleCard as Card } from "@dailybrief/shared";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { motion } from "motion/react";
import { timeAgo } from "../lib/format.ts";
import { useNow } from "../lib/now.ts";

const EASE = [0.2, 0, 0, 1] as const;

export function ArticleCard({ card, accent, delay, onOpen }: { card: Card; accent: string; delay: number; onOpen: () => void }) {
  const now = useNow();
  return (
    <motion.button
      layoutId={`card-${card.id}`}
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE, delay } }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2, ease: EASE } }}
      transition={{ type: "spring", bounce: 0, duration: 0.34 }}
      style={{ borderRadius: 16, backgroundImage: `radial-gradient(120% 80% at 0% 0%, ${accent}0f, transparent 60%)` }}
      className="group flex h-full w-full flex-col overflow-hidden border border-line bg-surface p-4 text-left transition-[border-color,box-shadow,translate] duration-150 active:scale-[0.99] [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
    >
      <motion.div layout="position" className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <span className="truncate">{card.publisher}</span>
        {card.sourceCount > 1 && <span className="shrink-0">· +{card.sourceCount - 1}</span>}
        {card.publishedAt && <span className="shrink-0">· {timeAgo(card.publishedAt, now)}</span>}
        {card.rating === "up" && <ThumbsUp className="ml-auto size-3.5 shrink-0 text-accent" />}
        {card.rating === "down" && <ThumbsDown className="ml-auto size-3.5 shrink-0" />}
      </motion.div>
      <motion.h3
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: delay + 0.05, duration: 0.26 } }}
        className="mt-2 line-clamp-3 text-[15px] leading-snug font-semibold tracking-[-0.01em] text-ink"
      >
        {card.headline}
      </motion.h3>
      <motion.p
        layout="position"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: delay + 0.11, duration: 0.26 } }}
        className="mt-2 line-clamp-5 text-[13.5px] leading-relaxed text-muted"
      >
        {card.summary}
      </motion.p>
    </motion.button>
  );
}

export function SkeletonCard({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="skeleton h-full rounded-2xl border border-line bg-surface p-4"
      style={{ animationDelay: `${index * 80}ms` }}
      aria-hidden
    >
      <div className="h-2.5 w-1/3 rounded-full bg-line-strong" />
      <div className="mt-4 h-3.5 w-11/12 rounded-full bg-line-strong" />
      <div className="mt-2 h-3.5 w-3/4 rounded-full bg-line-strong" />
      <div className="mt-5 space-y-2">
        <div className="h-2.5 w-full rounded-full bg-line" />
        <div className="h-2.5 w-full rounded-full bg-line" />
        <div className="h-2.5 w-2/3 rounded-full bg-line" />
      </div>
    </motion.div>
  );
}
