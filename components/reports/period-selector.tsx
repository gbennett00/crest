"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { yearFromPeriodKey, yearPeriodKey } from "@/lib/reports";

const FIXED_OPTIONS = [
  { key: "month", label: "This Month" },
  { key: "3m", label: "Last 3 Mo" },
  { key: "6m", label: "Last 6 Mo" },
  { key: "year", label: "This Year" },
] as const;

/**
 * The period pill row on desktop, collapsing to a single dropdown on mobile
 * so it doesn't push the chart/list down the screen.
 */
export function PeriodSelector({
  periodKey,
  years,
  onSelect,
}: {
  periodKey: string;
  years: number[];
  onSelect: (key: string) => void;
}) {
  const activeYear = yearFromPeriodKey(periodKey);
  const allOptions = [
    ...FIXED_OPTIONS,
    ...years.map((y) => ({ key: yearPeriodKey(y), label: String(y) })),
    { key: "all", label: "All Time" },
  ];

  return (
    <>
      {/* Desktop / tablet: segmented pill row */}
      <div className="hidden md:flex items-center gap-1 p-1 bg-muted rounded-full w-fit">
        {FIXED_OPTIONS.map((opt) => (
          <Pill key={opt.key} active={periodKey === opt.key} onClick={() => onSelect(opt.key)}>
            {opt.label}
          </Pill>
        ))}
        {years.length > 0 && (
          <YearDropdown years={years} activeYear={activeYear} onSelect={onSelect} />
        )}
        <Pill active={periodKey === "all"} onClick={() => onSelect("all")}>
          All Time
        </Pill>
      </div>

      {/* Mobile: one dropdown so the period control never pushes the chart down */}
      <div className="md:hidden relative">
        <select
          value={periodKey}
          onChange={(e) => onSelect(e.target.value)}
          className={cn(
            "w-full appearance-none rounded-lg bg-muted px-3.5 py-2.5 text-[13.5px] font-semibold",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        >
          {allOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </>
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
        "px-4 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
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

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={ref} className="relative">
      <Pill active={activeYear !== null} onClick={() => setOpen((o) => !o)}>
        <span className="inline-flex items-center gap-1">
          {activeYear ?? "Year"}
          <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
        </span>
      </Pill>
      {open && (
        <div
          role="listbox"
          aria-label="Select year"
          className="absolute left-1/2 top-full z-20 mt-1 w-32 -translate-x-1/2 rounded-lg border bg-background p-1 shadow-lg max-h-64 overflow-y-auto"
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
