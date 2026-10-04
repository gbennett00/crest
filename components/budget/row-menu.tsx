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
// touch or right-clicking it on desktop. Spread `pressHandlers` onto the row
// and render `menu` anywhere inside it.
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
  // Kept after close so the menu doesn't jump while animating out. Null until
  // the first press, which also keeps the portal out of the server render.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  // The chosen action runs once the menu has fully closed; otherwise the
  // menu's focus trap pulls focus back out of the rename input / target popup.
  const pendingRef = useRef<(() => void) | null>(null);

  const pressHandlers = useLongPress(
    (p) => {
      setPoint(p);
      setOpen(true);
    },
    { disabled },
  );

  const menu = (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {point &&
        createPortal(
          // Zero-size anchor at the press point for the menu to position against.
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              className="pointer-events-none fixed size-0"
              style={{ left: point.x, top: point.y }}
            />
          </DropdownMenuTrigger>,
          document.body,
        )}
      <DropdownMenuContent
        align="start"
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

  return { pressHandlers, menu };
}

// Applied to long-pressable rows: suppress iOS text selection and the
// link-preview callout, while keeping inputs inside the row editable.
export const LONG_PRESS_ROW_CLASS =
  "select-none [-webkit-touch-callout:none] [&_input]:select-text";
