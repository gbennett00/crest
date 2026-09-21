"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountOption } from "@/components/transactions/transaction-form";

const fieldInputClass =
  "w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

const PANEL_WIDTH = 256; // matches w-64
const VIEWPORT_MARGIN = 12;

/** Account, date range, and amount range, tucked behind one button so they
 * don't take up permanent space next to search. */
export function FiltersMenu({
  accountId,
  dateFrom,
  dateTo,
  amountMin,
  amountMax,
  accountOptions,
  onAccountChange,
  onDateFromChange,
  onDateToChange,
  onAmountMinChange,
  onAmountMaxChange,
}: {
  accountId: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  accountOptions: AccountOption[];
  onAccountChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onAmountMinChange: (v: string) => void;
  onAmountMaxChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // The trigger sits in a flex-wrap row, so its position on screen isn't
  // predictable (it can land anywhere depending on how much wrapped) — an
  // `absolute right-0` panel anchored to it can run off the left edge of a
  // narrow viewport. Measure the trigger and position the panel as `fixed`,
  // clamped to stay fully on screen, instead.
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.right - PANEL_WIDTH, VIEWPORT_MARGIN),
        window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN,
      );
      setPanelPos({ top: rect.bottom + 6, left });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = !!accountId || !!dateFrom || !!dateTo || !!amountMin || !!amountMax;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="More filters"
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors",
          open ? "border-primary text-foreground" : "border-input hover:bg-accent hover:text-foreground",
        )}
      >
        <SlidersHorizontal size={15} />
        {active && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />}
      </button>

      {open && panelPos && (
        <div
          style={{ top: panelPos.top, left: panelPos.left, width: PANEL_WIDTH }}
          className="fixed z-30 rounded-xl border bg-popover shadow-lg p-3 flex flex-col gap-3"
        >
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="txn-filter-account">
              Account
            </label>
            <select
              id="txn-filter-account"
              value={accountId}
              onChange={(e) => onAccountChange(e.target.value)}
              className={cn(fieldInputClass, "mt-1")}
            >
              <option value="">All accounts</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Date</span>
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-8 shrink-0">From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => onDateFromChange(e.target.value)}
                  aria-label="From date"
                  className={fieldInputClass}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-8 shrink-0">To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => onDateToChange(e.target.value)}
                  aria-label="To date"
                  className={fieldInputClass}
                />
              </div>
            </div>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground">Amount</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={amountMin}
                onChange={(e) => onAmountMinChange(e.target.value)}
                placeholder="Min"
                aria-label="Minimum amount"
                className={fieldInputClass}
              />
              <span className="text-xs text-muted-foreground shrink-0">to</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountMax}
                onChange={(e) => onAmountMaxChange(e.target.value)}
                placeholder="Max"
                aria-label="Maximum amount"
                className={fieldInputClass}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
