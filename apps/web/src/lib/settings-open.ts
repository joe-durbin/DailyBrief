import type { SettingsTab } from "../settings/SettingsDialog.tsx";

/** Open Settings at a tab from anywhere (e.g. the dashboard's "Connect AI" reminder); AppShell listens. */
const EVENT = "dailybrief:open-settings";

export function openSettings(tab: SettingsTab): void {
  window.dispatchEvent(new CustomEvent<SettingsTab>(EVENT, { detail: tab }));
}

export function onOpenSettings(listener: (tab: SettingsTab) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<SettingsTab>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
