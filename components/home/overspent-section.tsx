"use client";

import { useState } from "react";
import { Money } from "@/components/money";
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
      <div className="divide-y">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.isGroup ? "Group budget" : item.groupName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTarget(item)}
              className="text-sm font-semibold tabular-nums text-destructive hover:underline"
            >
              <Money cents={item.availableCents} />
            </button>
          </div>
        ))}
      </div>
      {coverTarget && (
        <CoverOverspendingPopup data={data} target={coverTarget} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
