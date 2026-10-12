/** "Kept" feedback: a ghost of the item flies from `from` to the Saved or Chats tab, which then bumps. */
const EVENT = "dailybrief:fly";

export type FlyTarget = "saved" | "chats";
export type FlyDetail = { from: DOMRect; target: FlyTarget };

export function flyTo(target: FlyTarget, from: DOMRect | undefined): void {
  if (from) window.dispatchEvent(new CustomEvent<FlyDetail>(EVENT, { detail: { from, target } }));
}

export function onFly(listener: (detail: FlyDetail) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<FlyDetail>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Duration of the flight; the tab bumps when the ghost lands. */
export const FLY_MS = 520;
