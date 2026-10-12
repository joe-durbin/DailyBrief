import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { FLY_MS, onFly } from "../lib/fly.ts";

type Flight = { id: number; from: DOMRect; to: DOMRect };

/** Renders the ghost card that flies to the Saved/Chats tab (top bar marks them with data-fly-target). */
export function FlyLayer() {
  const [flights, setFlights] = useState<Flight[]>([]);
  useEffect(
    () =>
      onFly(({ from, target }) => {
        const to = document.querySelector(`[data-fly-target="${target}"]`)?.getBoundingClientRect();
        if (!to) return;
        const id = Date.now() + Math.random();
        setFlights((f) => [...f, { id, from, to }]);
        setTimeout(() => setFlights((f) => f.filter((x) => x.id !== id)), FLY_MS + 50);
      }),
    [],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
      <AnimatePresence>
        {flights.map(({ id, from, to }) => (
          <motion.div
            key={id}
            className="absolute rounded-2xl border border-accent/50 bg-accent/15"
            initial={{ left: from.left, top: from.top, width: from.width, height: from.height, opacity: 0.9 }}
            animate={{ left: to.left + to.width / 2 - 12, top: to.top + to.height / 2 - 8, width: 24, height: 16, opacity: 0.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FLY_MS / 1000, ease: [0.4, 0, 0.2, 1] }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
