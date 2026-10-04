"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Target } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLongPress } from "@/lib/use-long-press";

// Per-row actions menu (rename + target), opened by long-pressing the row on
// touch or right-clicking it on desktop. Spread `rowProps` onto the row (with
// LONG_PRESS_ROW_CLASS) and render `menu` anywhere inside it.
export function useRowMenu({
  onRename,
  onEditTarget,
  hasTarget,
  disabled = false,
}: {
  onRename: () => void;
  onEditTarget?: () => void;
  hasTarget: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The row's on-screen box, which the menu is anchored to. Kept after close so
  // the menu doesn't jump while animating out. Null until the first press,
  // which also keeps the portal out of the server render.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // The chosen action runs once the menu has fully closed; otherwise the
  // menu's focus trap pulls focus back out of the rename input / target popup.
  const pendingRef = useRef<(() => void) | null>(null);

  const { pressing, handlers } = useLongPress(
    (row) => {
      setAnchor(row.getBoundingClientRect());
      setOpen(true);
    },
    { disabled },
  );
  // Tinted while held and while the menu is open, so it's clear the press
  // registered even when the thumb hides the menu.
  const rowProps = {
    ...handlers,
    "data-pressed": pressing || open ? "" : undefined,
  };

  const menu = (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {anchor &&
        createPortal(
          // Invisible copy of the row's box for the menu to position against.
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              className="pointer-events-none fixed"
              style={{
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
                height: anchor.height,
              }}
            />
          </DropdownMenuTrigger>,
          document.body,
        )}
      <DropdownMenuContent
        // Above the row, clear of the thumb doing the pressing; Radix flips it
        // below when there's no room.
        side="top"
        align="start"
        alignOffset={16}
        sideOffset={6}
        className="w-40"
        // Clicks inside the portaled menu still bubble through the row in
        // React's tree; don't let them trigger the row's tap action.
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          pendingRef.current?.();
          pendingRef.current = null;
        }}
      >
        <DropdownMenuItem onSelect={() => (pendingRef.current = onRename)} className="gap-2">
          <Pencil size={14} /> Rename
        </DropdownMenuItem>
        {onEditTarget && (
          <DropdownMenuItem onSelect={() => (pendingRef.current = onEditTarget)} className="gap-2">
            <Target size={14} /> {hasTarget ? "Edit target" : "Set target"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return { rowProps, menu };
}

// Applied to long-pressable rows: suppress iOS text selection and the
// link-preview callout (keeping inputs inside the row editable), and tint the
// row while it's pressed / its menu is open.
export const LONG_PRESS_ROW_CLASS =
  "select-none [-webkit-touch-callout:none] [&_input]:select-text data-[pressed]:!bg-primary/15 dark:data-[pressed]:!bg-primary/30";
