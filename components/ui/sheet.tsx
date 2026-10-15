"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { OverlayContainerContext } from "@/components/ui/overlay-container";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Replaces the close-only header with a back chevron (a step inside a sheet). */
  onBack?: () => void;
  children: React.ReactNode;
  /** Sticky footer, normally Cancel plus the one primary Button, each `flex-1`. */
  footer?: React.ReactNode;
  /** Drawer form for tall lists: about 90% of the screen. Otherwise sizes to content. */
  tall?: boolean;
  /** Extra classes for the body (the scrolling region). */
  className?: string;
};

/**
 * The single overlay for creating and editing things. Rises from the bottom
 * over a scrim, with a grabber, a title row, a scrolling body and an optional
 * sticky footer. Never stack sheets: replace the content in place and pass
 * `onBack` instead. Built on Radix Dialog for focus trapping, Escape and
 * scroll locking.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  onBack,
  children,
  footer,
  tall,
  className,
}: SheetProps) {
  // Node inside the dialog content that overlays opened from within the sheet
  // portal into (see overlay-container.tsx).
  const [overlayContainer, setOverlayContainer] = React.useState<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // An overlay open inside the sheet (category picker, keypad) handles
          // Escape itself; don't also close the sheet underneath it.
          onEscapeKeyDown={(e) => {
            if (overlayContainer?.childElementCount) e.preventDefault();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col rounded-t-ds-xl border border-b-0 bg-surface-raised text-ink shadow-sheet",
            "max-h-[90dvh] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-200 motion-reduce:animate-none",
            tall && "h-[90dvh]",
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-pill bg-border-strong"
          />
          <div className="flex shrink-0 items-center justify-between gap-2 py-2 pl-5 pr-4">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="-ml-3 flex h-tap w-tap shrink-0 items-center justify-center text-ink-muted hover:text-ink"
              >
                <ChevronLeft size={24} strokeWidth={1.75} />
              </button>
            )}
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-title">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex h-tap w-tap shrink-0 items-center justify-center text-ink-muted hover:text-ink"
            >
              <X size={24} strokeWidth={1.75} />
            </DialogPrimitive.Close>
          </div>
          <OverlayContainerContext.Provider value={overlayContainer}>
            <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2", className)}>
              {children}
            </div>
          </OverlayContainerContext.Provider>
          {footer && (
            <div className="flex shrink-0 gap-3 border-t px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
          <div ref={setOverlayContainer} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
