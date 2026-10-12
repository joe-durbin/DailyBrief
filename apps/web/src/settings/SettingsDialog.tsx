import type { AppSettings, BriefFill } from "@dailybrief/shared";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, LayoutGrid, Sparkles, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { api } from "../api.ts";
import { applyTheme, currentTheme, THEMES, type ThemeId } from "../lib/theme.ts";
import { AccountTab } from "./AccountTab.tsx";
import { AiTab } from "./AiTab.tsx";
import { DataTab } from "./DataTab.tsx";
import { RssTab, ScheduleTab, SearchTab } from "./SearchScheduleTabs.tsx";
import { UsageTab } from "./UsageTab.tsx";

const FILL_OPTIONS: { value: BriefFill; label: string; description: string; icon: LucideIcon }[] = [
  { value: "fill", label: "Maximum coverage", description: "Up to 15 stories a day. On quieter days the brief is topped up with the next-best stories, so you see the widest range of news.", icon: LayoutGrid },
  { value: "standout", label: "Highlights only", description: "Only the stories that really stand out. Quiet days may bring just a handful.", icon: Sparkles },
];

const TABS = [
  { id: "brief", label: "Daily brief" },
  { id: "appearance", label: "Appearance" },
  { id: "ai", label: "AI" },
  { id: "search", label: "Search" },
  { id: "schedule", label: "Schedule" },
  { id: "rss", label: "RSS" },
  { id: "usage", label: "Usage" },
  { id: "account", label: "Account" },
  { id: "data", label: "Data" },
] as const;

export type SettingsTab = (typeof TABS)[number]["id"];

export function SettingsDialog({ open, onOpenChange, tab: initialTab = "brief" }: { open: boolean; onOpenChange: (open: boolean) => void; tab?: SettingsTab }) {
  const tab = "rounded-[10px] px-3 py-2 text-left text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-ink data-[state=active]:bg-bg/60 data-[state=active]:text-ink";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed top-1/2 left-1/2 z-50 flex h-[min(680px,88dvh)] w-[min(820px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[20px] border border-line bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <Dialog.Title className="text-lg font-semibold tracking-tight">Settings</Dialog.Title>
            <Dialog.Close aria-label="Close" className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-bg/60 hover:text-ink">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Application settings</Dialog.Description>

          <Tabs.Root key={initialTab} defaultValue={initialTab} orientation="vertical" className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <Tabs.List aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
              {TABS.map((t) => (
                <Tabs.Trigger key={t.id} value={t.id} className={tab}>
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <Tabs.Content value="brief">
                <BriefFillSetting enabled={open} />
              </Tabs.Content>
              <Tabs.Content value="appearance">
                <ThemeSetting />
              </Tabs.Content>
              <Tabs.Content value="ai">
                <AiTab />
              </Tabs.Content>
              <Tabs.Content value="search">
                <SearchTab />
              </Tabs.Content>
              <Tabs.Content value="schedule">
                <ScheduleTab />
              </Tabs.Content>
              <Tabs.Content value="rss">
                <RssTab />
              </Tabs.Content>
              <Tabs.Content value="usage">
                <UsageTab />
              </Tabs.Content>
              <Tabs.Content value="account">
                <AccountTab />
              </Tabs.Content>
              <Tabs.Content value="data">
                <DataTab />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function BriefFillSetting({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<AppSettings>("/api/settings"), enabled });
  const save = useMutation({
    mutationFn: (briefFill: BriefFill) => api<AppSettings>("/api/settings", { method: "PUT", body: { briefFill } }),
    onSuccess: (data) => queryClient.setQueryData(["settings"], data),
  });
  const current = save.isPending ? save.variables : settings.data?.briefFill;

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Daily brief</h3>
      <p className="mb-3 text-sm text-muted">How many stories each brief should have. Applies from the next brief.</p>
      <div role="radiogroup" aria-label="Stories per brief" className="grid gap-3 sm:grid-cols-2">
        {FILL_OPTIONS.map(({ value, label, description, icon: Icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              role="radio"
              aria-checked={selected}
              onClick={() => !selected && save.mutate(value)}
              className={clsx(
                "flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors",
                selected ? "border-accent/60 bg-accent/10" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className={clsx("size-4", selected ? "text-accent" : "text-muted")} />
                {label}
              </span>
              <span className="text-sm leading-snug text-muted">{description}</span>
            </button>
          );
        })}
      </div>
      {save.error && <p className="mt-2 text-sm text-danger">{save.error.message}</p>}
    </section>
  );
}

export function ThemeSetting() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const pick = (id: ThemeId) => {
    applyTheme(id);
    setTheme(id);
  };
  const ids = Object.keys(THEMES) as ThemeId[];

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Theme</h3>
      <p className="mb-3 text-sm text-muted">Applies straight away and is remembered on this device.</p>
      {(["Dark", "Light"] as const).map((group) => (
        <div key={group} className="mb-5">
          <p className="mb-2 text-xs font-medium text-muted">{group}</p>
          <div role="radiogroup" aria-label={`${group} themes`} className="grid gap-3 sm:grid-cols-3">
            {ids
              .filter((id) => THEMES[id].dark === (group === "Dark"))
              .map((id) => {
                const [bg, surface, accent, ink] = THEMES[id].swatch;
                const selected = theme === id;
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => pick(id)}
                    className={clsx("overflow-hidden rounded-2xl border text-left transition-colors", selected ? "border-accent/70 ring-1 ring-accent/50" : "border-line hover:border-line-strong")}
                  >
                    {/* Miniature of the app in that theme: page, a card with a headline and an accent button. */}
                    <span className="flex h-20 gap-1.5 p-2.5" style={{ backgroundColor: bg }}>
                      <span className="flex flex-1 flex-col gap-1.5 rounded-lg p-2" style={{ backgroundColor: surface }}>
                        <span className="h-1.5 w-4/5 rounded-full" style={{ backgroundColor: ink }} />
                        <span className="h-1.5 w-3/5 rounded-full opacity-50" style={{ backgroundColor: ink }} />
                        <span className="mt-auto h-2.5 w-8 rounded-full" style={{ backgroundColor: accent }} />
                      </span>
                      <span className="w-5 rounded-lg" style={{ backgroundColor: surface }} />
                    </span>
                    <span className="flex items-center justify-between gap-2 bg-surface px-3 py-2 text-sm font-medium">
                      {THEMES[id].label}
                      {selected && <Check className="size-4 text-accent" />}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}
