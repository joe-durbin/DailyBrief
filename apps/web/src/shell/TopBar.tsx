import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bookmark, CircleHelp, LayoutGrid, LogOut, MessagesSquare, Rss, Settings, type LucideIcon } from "lucide-react";
import { motion, useAnimationControls } from "motion/react";
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router";
import { FLY_MS, onFly, type FlyTarget } from "../lib/fly.ts";
import { api } from "../api.ts";
import { IconButton } from "../ui/IconButton.tsx";
import { Logo } from "./Logo.tsx";
import { ManualDialog } from "./ManualDialog.tsx";

/** Registry of top-level modes; new modes slot in here without layout changes. */
const MODES: { to: string; label: string; icon: LucideIcon; flyTarget?: FlyTarget }[] = [
  { to: "/briefs", label: "Briefs", icon: LayoutGrid },
  { to: "/rss", label: "RSS", icon: Rss },
  { to: "/saved", label: "Saved", icon: Bookmark, flyTarget: "saved" },
  { to: "/chats", label: "Chats", icon: MessagesSquare, flyTarget: "chats" },
];

export function TopBar({ username, onOpenSettings }: { username: string; onOpenSettings: () => void }) {
  const queryClient = useQueryClient();
  const bumpSaved = useAnimationControls();
  const bumpChats = useAnimationControls();
  // When a kept item's ghost lands on its tab, give the tab a small bump.
  useEffect(
    () =>
      onFly(({ target }) => {
        const bump = target === "saved" ? bumpSaved : bumpChats;
        setTimeout(() => void bump.start({ scale: [1, 1.15, 1], transition: { duration: 0.32 } }), FLY_MS - 60);
      }),
    [bumpSaved, bumpChats],
  );
  const [manualOpen, setManualOpen] = useState(false);
  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      // Refetch the auth state first: the app swaps to the login screen and unmounts every view.
      // (Clearing the cache first would delete the auth query itself, leaving nothing to refetch.)
      await queryClient.refetchQueries({ queryKey: ["auth"] });
      // Then drop everything cached from the signed-in session.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-3 backdrop-blur sm:gap-5 sm:px-4">
      <Link to="/" aria-label="DailyBrief — dashboard" className="-mx-1.5 flex min-h-9 items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-2">
        <Logo className="size-6" />
        <span className="hidden text-sm font-semibold tracking-tight md:inline">DailyBrief</span>
      </Link>

      <nav className="relative flex rounded-[10px] bg-bg/60 p-0.5 ring-1 ring-line" aria-label="Mode">
        {MODES.map(({ to, label, icon: Icon, flyTarget }) => (
          <NavLink
            key={to}
            data-fly-target={flyTarget}
            to={to}
            className={({ isActive }) =>
              clsx(
                "relative flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors",
                isActive ? "text-ink" : "text-muted hover:text-ink",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="mode-highlight"
                    className="absolute inset-0 rounded-[8px] bg-surface-2 ring-1 ring-line-strong"
                    transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                  />
                )}
                <motion.span animate={flyTarget === "saved" ? bumpSaved : flyTarget === "chats" ? bumpChats : undefined} className="relative">
                  <Icon className="size-4" />
                </motion.span>
                <span className="relative hidden sm:inline">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <IconButton icon={CircleHelp} label="Help — user manual" onClick={() => setManualOpen(true)} />
        <ManualDialog open={manualOpen} onOpenChange={setManualOpen} />
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={onOpenSettings}
              aria-label="Settings"
              className="grid size-10 place-items-center rounded-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Settings className="size-[18px]" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content sideOffset={6} className="rounded-md bg-surface-2 px-2 py-1 text-xs text-ink ring-1 ring-line-strong">
              Settings
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label="Account"
              className="grid size-10 place-items-center rounded-full outline-none"
            >
              <span className="grid size-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent uppercase ring-1 ring-accent/30">
                {username.slice(0, 1)}
              </span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="min-w-48 rounded-xl bg-surface-2 p-1.5 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-1 ring-line-strong"
            >
              <div className="px-2.5 py-2 text-xs text-muted">
                Signed in as <span className="text-ink">{username}</span>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                onSelect={() => void signOut()}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-highlighted:bg-bg/60"
              >
                <LogOut className="size-4 text-muted" /> Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
