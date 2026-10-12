import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";

/** The user manual (/manual.html, built from README.html) in a large dialog. */
export function ManualDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed top-1/2 left-1/2 z-50 flex h-[min(900px,90dvh)] w-[min(1100px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[20px] border border-line bg-surface-2 shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none">
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <Dialog.Title className="text-base font-semibold tracking-tight">User manual</Dialog.Title>
            <span className="text-xs text-muted tabular-nums">DailyBrief v{__APP_VERSION__}</span>
            <a
              href="/manual.html"
              target="_blank"
              rel="noopener"
              className="ml-auto flex min-h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-sm text-muted hover:bg-bg/60 hover:text-ink"
            >
              <ExternalLink className="size-4" />
              <span className="hidden sm:inline">Open in new tab</span>
            </a>
            <Dialog.Close aria-label="Close" className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-bg/60 hover:text-ink">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">How to use DailyBrief</Dialog.Description>
          {/* The manual follows the chosen theme (/manual-theme.js reads it). */}
          <iframe src="/manual.html" title="DailyBrief user manual" className="min-h-0 w-full flex-1 bg-bg" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
