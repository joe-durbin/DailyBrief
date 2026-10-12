import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  /** Tooltip text and accessible name. */
  label: string;
  /** Short caption shown under the icon on touch screens, where tooltips don't exist. */
  touchLabel?: string;
  active?: boolean;
  iconClassName?: string;
};

/** Icon button: 40px with a tooltip on mouse/trackpad, 44px (optionally captioned) on touch. */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon: Icon, label, touchLabel, active, className, iconClassName, ...rest }, ref) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={clsx(
            "grid size-10 shrink-0 place-items-center rounded-[10px] transition-colors disabled:opacity-50 [@media(pointer:coarse)]:size-11",
            touchLabel && "[@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-auto [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:px-1.5",
            active ? "bg-accent/15 text-accent" : "text-muted [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-ink",
            className,
          )}
          {...rest}
        >
          <motion.span
            key={active ? "on" : "off"}
            initial={active ? { scale: 0.7 } : false}
            animate={active ? { scale: [null, 1.22, 1] } : { scale: 1 }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
            className="grid place-items-center"
          >
            <Icon className={clsx("size-[18px]", iconClassName, active && "fill-current/20")} />
          </motion.span>
          {touchLabel && <span className="hidden text-[10px] leading-none font-medium [@media(pointer:coarse)]:block">{touchLabel}</span>}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 rounded-md bg-surface-2 px-2 py-1 text-xs text-ink ring-1 ring-line-strong [@media(pointer:coarse)]:hidden">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});
