"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Budget months are the first day of the month (`YYYY-MM-01`).
function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

function formatMonth(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function currentRealMonth(): string {
  const now = new Date();
  return monthKey(now.getFullYear(), now.getMonth());
}

/**
 * Center control of the budget month bar: shows the active month and opens a
 * year + 12-month grid to jump directly to any month within [minMonth, maxMonth]
 * — no more clicking the chevrons one step at a time. `onSelect` receives a
 * `YYYY-MM-01` string and is expected to navigate.
 */
export function MonthPicker({
  month,
  minMonth,
  maxMonth,
  onSelect,
}: {
  month: string;
  minMonth: string;
  maxMonth: string;
  onSelect: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Year shown in the grid; starts on the active month's year and is local to
  // the popover so paging the year doesn't navigate until a month is picked.
  const [viewYear, setViewYear] = useState(() => +month.slice(0, 4));
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset the viewed year to the active month whenever the popover reopens or
  // the month changes underneath it (e.g. via the chevrons).
  useEffect(() => {
    if (open) setViewYear(+month.slice(0, 4));
  }, [open, month]);

  // Close on outside click or Escape.
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

  const today = currentRealMonth();
  const minYear = +minMonth.slice(0, 4);
  const maxYear = +maxMonth.slice(0, 4);

  function pick(monthIndex: number) {
    const target = monthKey(viewYear, monthIndex);
    if (target < minMonth || target > maxMonth) return;
    onSelect(target);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded font-semibold text-sm hover:bg-accent transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {formatMonth(month)}
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select month"
          className="absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border bg-background p-2 shadow-lg"
        >
          {/* Year stepper */}
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              onClick={() => setViewYear((y) => y - 1)}
              disabled={viewYear <= minYear}
              className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Previous year"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-semibold text-sm tabular-nums">{viewYear}</span>
            <button
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= maxYear}
              className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="Next year"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* 12-month grid, 4 columns */}
          <div className="grid grid-cols-4 gap-1">
            {MONTH_ABBR.map((abbr, i) => {
              const key = monthKey(viewYear, i);
              const disabled = key < minMonth || key > maxMonth;
              const isActive = key === month;
              const isToday = key === today;
              return (
                <button
                  key={abbr}
                  onClick={() => pick(i)}
                  disabled={disabled}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "h-9 rounded text-sm transition-colors",
                    "disabled:opacity-30 disabled:pointer-events-none",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "hover:bg-accent",
                    !isActive && isToday && "ring-1 ring-inset ring-primary/50",
                  )}
                >
                  {abbr}
                </button>
              );
            })}
          </div>

          {/* Jump to the current real month — the most common jump. */}
          {month !== today && today >= minMonth && today <= maxMonth && (
            <button
              onClick={() => {
                onSelect(today);
                setOpen(false);
              }}
              className="mt-2 w-full rounded py-1.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
            >
              Go to {formatMonth(today)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
