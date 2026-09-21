"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMonthLabel,
  monthFromPeriodKey,
  monthPeriodKey,
  yearFromPeriodKey,
  yearPeriodKey,
} from "@/lib/reports";

const FIXED_OPTIONS = [
  { key: "month", label: "This Month" },
  { key: "3m", label: "Last 3 Mo" },
  { key: "6m", label: "Last 6 Mo" },
  { key: "year", label: "This Year" },
] as const;

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The period control — a single horizontally-scrollable pill row at every
 * width (no separate mobile `<select>`: it can't host the month grid below).
 */
export function PeriodSelector({
  periodKey,
  years,
  months,
  onSelect,
}: {
  periodKey: string;
  years: number[];
  /** Budget months (YYYY-MM-01) with any spending — what the month picker can jump to. */
  months: string[];
  onSelect: (key: string) => void;
}) {
  const activeYear = yearFromPeriodKey(periodKey);
  const activeMonth = monthFromPeriodKey(periodKey);

  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-full w-fit max-w-full overflow-x-auto">
      {FIXED_OPTIONS.map((opt) => (
        <Pill key={opt.key} active={periodKey === opt.key} onClick={() => onSelect(opt.key)}>
          {opt.label}
        </Pill>
      ))}
      {months.length > 0 && (
        <MonthDropdown months={months} activeMonth={activeMonth} onSelect={onSelect} />
      )}
      {years.length > 0 && (
        <YearDropdown years={years} activeYear={activeYear} onSelect={onSelect} />
      )}
      <Pill active={periodKey === "all"} onClick={() => onSelect("all")}>
        All Time
      </Pill>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors shrink-0",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function useClickOutsideAndEscape(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * Viewport coordinates for a `position: fixed` popover anchored under
 * `triggerRef`, kept in sync while scrolling/resizing. Fixed (not absolute)
 * so the popover escapes the period row's own `overflow-x-auto` — an
 * ancestor scroll container clips an absolutely positioned descendant even
 * when only overflow-x is set, because the CSS overflow property forces
 * overflow-y to 'auto' too once overflow-x isn't 'visible'. Capture phase on
 * scroll because the period row's own scroll doesn't bubble to window.
 */
function usePopoverCoords(open: boolean, triggerRef: React.RefObject<HTMLElement | null>) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function update() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return coords;
}

function YearDropdown({
  years,
  activeYear,
  onSelect,
}: {
  years: number[];
  activeYear: number | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideAndEscape(open, ref, () => setOpen(false));
  const coords = usePopoverCoords(open, ref);

  return (
    <div ref={ref} className="relative shrink-0">
      <Pill active={activeYear !== null} onClick={() => setOpen((o) => !o)}>
        <span className="inline-flex items-center gap-1">
          {activeYear ?? "Year"}
          <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
        </span>
      </Pill>
      {open && coords && (
        <div
          role="listbox"
          aria-label="Select year"
          style={{ top: coords.top, left: coords.left }}
          className="fixed z-20 w-32 -translate-x-1/2 rounded-lg border bg-background p-1 shadow-lg max-h-64 overflow-y-auto"
        >
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                onSelect(yearPeriodKey(y));
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 rounded text-sm tabular-nums transition-colors",
                y === activeYear ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthDropdown({
  months,
  activeMonth,
  onSelect,
}: {
  /** Budget months (YYYY-MM-01) with spending — the only ones selectable. */
  months: string[];
  activeMonth: string | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const monthSet = new Set(months);
  const years = [...new Set(months.map((m) => +m.slice(0, 4)))].sort((a, b) => a - b);
  const minYear = years[0];
  const maxYear = years[years.length - 1];
  const [viewYear, setViewYear] = useState(() => (activeMonth ? +activeMonth.slice(0, 4) : maxYear));
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideAndEscape(open, ref, () => setOpen(false));
  const coords = usePopoverCoords(open, ref);

  useEffect(() => {
    if (open) setViewYear(activeMonth ? +activeMonth.slice(0, 4) : maxYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function monthKey(monthIndex: number): string {
    return `${viewYear}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <Pill active={activeMonth !== null} onClick={() => setOpen((o) => !o)}>
        <span className="inline-flex items-center gap-1">
          {activeMonth ? formatMonthLabel(activeMonth).slice(0, 3) + " " + activeMonth.slice(0, 4) : "Month"}
          <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
        </span>
      </Pill>
      {open && coords && (
        <div
          role="dialog"
          aria-label="Select month"
          style={{ top: coords.top, left: coords.left }}
          className="fixed z-20 w-64 -translate-x-1/2 rounded-lg border bg-background p-2 shadow-lg"
        >
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
          <div className="grid grid-cols-4 gap-1">
            {MONTH_ABBR.map((abbr, i) => {
              const key = monthKey(i);
              const disabled = !monthSet.has(key);
              const isActive = key === activeMonth;
              return (
                <button
                  key={abbr}
                  onClick={() => {
                    onSelect(monthPeriodKey(key));
                    setOpen(false);
                  }}
                  disabled={disabled}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "h-9 rounded text-sm transition-colors",
                    "disabled:opacity-30 disabled:pointer-events-none",
                    isActive ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent",
                  )}
                >
                  {abbr}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
