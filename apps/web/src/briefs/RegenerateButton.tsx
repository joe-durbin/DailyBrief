import * as AlertDialog from "@radix-ui/react-alert-dialog";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../ui/IconButton.tsx";

export function RegenerateButton({ topicName, busy, hasCards, onConfirm }: { topicName: string; busy: boolean; hasCards: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <IconButton
      icon={RefreshCw}
      label={busy ? "Generating…" : "Regenerate brief"}
      disabled={busy}
      iconClassName={clsx(busy && "animate-spin")}
      onClick={() => (hasCards ? setOpen(true) : onConfirm())}
    />
  );
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      {trigger}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <AlertDialog.Content className="dialog-content fixed top-1/2 left-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-line bg-surface-2 p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
          <AlertDialog.Title className="text-lg font-semibold tracking-tight">Regenerate today's {topicName} brief?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted">
            Articles you haven't saved will be removed and a fresh set generated. Saved articles are kept, and stories you've ignored won't come back.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel className="min-h-10 rounded-[10px] border border-line-strong px-4 text-sm font-medium hover:bg-surface">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action onClick={onConfirm} className="min-h-10 rounded-[10px] bg-accent px-4 text-sm font-semibold text-on-accent hover:brightness-110">
              Regenerate
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
