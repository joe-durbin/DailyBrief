import type { TouchEvent } from "react";

const MIN_DX = 90;
const MAX_DY = 50;

/** Touch handlers that call `onSwipe` for a deliberate left-to-right swipe (iPad back gesture). */
export function swipeRight(onSwipe: (() => void) | undefined) {
  if (!onSwipe) return {};
  let start: { x: number; y: number } | null = null;
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start = t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (start && t && t.clientX - start.x > MIN_DX && Math.abs(t.clientY - start.y) < MAX_DY) onSwipe();
      start = null;
    },
  };
}
