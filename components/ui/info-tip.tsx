"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

const PANEL_WIDTH = 256;
const GUTTER = 16;

/**
 * An ⓘ button that reveals a short explanation. A tap (or Enter/Space)
 * toggles it — touch has no hover; with a mouse it opens on hover and stays
 * open on click. Closes on Escape, or a click/tap outside.
 */
export function InfoTip({
  label,
  children,
  className,
}: {
  /** Accessible name for the button, e.g. "About categorization rules". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement>(null);
  const panelId = React.useId();
  // How the latest press started: a mouse click while hover already opened
  // the panel must keep it open rather than toggle it shut.
  const pressType = React.useRef<string>("");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  // Fixed-position coordinates, so the panel can't run off a phone screen
  // however close to the edge the button sits.
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(PANEL_WIDTH, vw - 2 * GUTTER);
    const left = Math.min(Math.max(rect.left, GUTTER), vw - GUTTER - width);
    setPos({ top: rect.bottom + 6, left, width });
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // The panel is pinned to where the button was; close rather than drift.
    function close() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerDown={(e) => {
          pressType.current = e.pointerType;
        }}
        onClick={() => {
          const mouse = pressType.current === "mouse";
          pressType.current = "";
          setOpen((v) => (mouse ? true : !v));
        }}
        className="p-1 rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
      >
        <Info size={15} />
      </button>
      {open && pos && (
        <span
          id={panelId}
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-50 rounded-md border bg-popover p-3 text-xs font-normal leading-relaxed text-popover-foreground shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
