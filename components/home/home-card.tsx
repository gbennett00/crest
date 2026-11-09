import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A Home card: `surface` on `bg`, radius-lg, hairline border, with a title
 * row (title, optional count badge, optional action on the right).
 */
export function HomeCard({
  id,
  title,
  subtitle,
  badge,
  action,
  children,
  className,
}: {
  id?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-4 overflow-hidden rounded-ds-lg border bg-surface", className)}
    >
      <div className="flex min-h-[52px] items-center gap-2 py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-headline text-ink">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="text-caption text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children && <div className="border-t">{children}</div>}
    </section>
  );
}

/** Small count chip next to a card title. */
export function CountBadge({
  count,
  tone = "zero",
}: {
  count: number;
  tone?: "warn" | "neg" | "zero";
}) {
  return (
    <span
      className={cn(
        "num inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-pill px-2 text-[13px] font-semibold",
        tone === "warn" && "bg-warn-bg text-warn-ink",
        tone === "neg" && "bg-neg-bg text-neg-ink",
        tone === "zero" && "bg-zero-bg text-zero-ink",
      )}
    >
      {count}
    </span>
  );
}

/** A category line on Home: name over its group, a pill (or control) on the right. */
export function HomeCategoryRow({
  name,
  groupName,
  trailing,
}: {
  name: string;
  groupName: string;
  trailing: React.ReactNode;
}) {
  return (
    <div className="flex min-h-row-list items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-strong text-ink">{name}</p>
        <p className="truncate text-caption text-ink-muted">{groupName}</p>
      </div>
      {trailing}
    </div>
  );
}
