import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useLocation, useOutlet } from "react-router";
import { useLiveEvents } from "../lib/live.ts";
import { onOpenSettings } from "../lib/settings-open.ts";
import { SettingsDialog, type SettingsTab } from "../settings/SettingsDialog.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { OfflineBanner } from "./ErrorBoundary.tsx";
import { FlyLayer } from "./FlyLayer.tsx";
import { TopBar } from "./TopBar.tsx";

export function AppShell({ username }: { username: string }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("brief");
  useEffect(
    () =>
      onOpenSettings((tab) => {
        setSettingsTab(tab);
        setSettingsOpen(true);
      }),
    [],
  );
  useLiveEvents();
  // Cross-fade between modes (Briefs / RSS / Saved) — keyed on the first path segment only,
  // so navigating within a mode (topic, article) doesn't replay it.
  const mode = useLocation().pathname.split("/")[1] ?? "";
  const outlet = useOutlet();
  return (
    <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
      <TopBar
        username={username}
        onOpenSettings={() => {
          setSettingsTab("brief");
          setSettingsOpen(true);
        }}
      />
      <OfflineBanner />
      <main className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            className="h-full"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} tab={settingsTab} />
      <Onboarding />
      <FlyLayer />
    </div>
  );
}
