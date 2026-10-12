import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Component, useSyncExternalStore, type ReactNode } from "react";

/** Last line of defence: a render error shows a calm recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-bg p-6 text-center">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-6">
          <p className="font-medium text-ink">Something went wrong</p>
          <p className="mt-1 text-sm text-muted">{this.state.error.message}</p>
          <button onClick={() => location.reload()} className="mt-4 min-h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent">
            Reload DailyBrief
          </button>
        </div>
      </div>
    );
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Thin banner while the device has no network (e.g. iPad leaving Wi-Fi); live updates resume automatically. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="flex shrink-0 items-center justify-center gap-2 overflow-hidden bg-warn/15 text-sm text-warn"
        >
          <span className="flex items-center gap-2 py-1.5">
            <WifiOff className="size-4" /> You're offline — DailyBrief will reconnect automatically.
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
