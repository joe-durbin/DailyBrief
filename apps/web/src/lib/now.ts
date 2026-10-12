import { useSyncExternalStore } from "react";

/**
 * One shared clock for everything shown relative to the current time ("8 hours ago", "Today", the greeting), so it
 * keeps up while a page stays open. Ticks every minute, and at once when the tab becomes visible again (timers
 * pause while a device sleeps). A single timer runs while anything is subscribed.
 */
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;

function tick() {
  now = Date.now();
  for (const listener of listeners) listener();
}

function onVisible() {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** The current time in ms, updated every minute; re-renders the caller when it changes. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
