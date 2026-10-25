"use client";

import { useState } from "react";
import { AvailablePill } from "@/components/ui/available-pill";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
import { CoverOverspendingPopup, type CoverTarget } from "@/components/budget/cover-overspending-popup";
import type { BudgetData, BudgetViewItem } from "@/lib/budget/types";

/**
 * Overspent list for the home screen. Clicking an item's negative amount
 * opens the same Cover Overspending popup as the budget screen, instead of
 * sending the user to /budget to find the category and click it there.
 */
export function OverspentSection({
  data,
  items,
}: {
  data: BudgetData;
  items: BudgetViewItem[];
}) {
  const [target, setTarget] = useState<BudgetViewItem | null>(null);

  const coverTarget: CoverTarget | null = target
    ? {
        type: target.isGroup ? "group" : "category",
        id: target.id,
        name: target.name,
        overspentCents: target.availableCents,
      }
    : null;

  return (
    <>
      <div>
        {items.map((item) => {
          const { emoji, label } = splitLeadingEmoji(item.name);
          return (
            <div
              key={item.id}
              className="flex min-h-row-list items-center gap-3 border-t px-4 py-2 first:border-t-0"
            >
              <span aria-hidden="true" className="w-7 shrink-0 text-center text-[22px] leading-6">
                {emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body">{label}</p>
                <p className="truncate text-caption text-ink-muted">
                  {item.isGroup ? "Group budget" : item.groupName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTarget(item)}
                aria-label={`${label} is overspent. Cover overspending`}
                className="rounded-pill"
              >
                <AvailablePill cents={item.availableCents} state="neg" />
              </button>
            </div>
          );
        })}
      </div>
      {coverTarget && (
        <CoverOverspendingPopup data={data} target={coverTarget} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
