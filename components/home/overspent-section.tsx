"use client";

import { useState } from "react";
import { AvailablePill } from "@/components/ui/available-pill";
import { CoverOverspendingPopup, type CoverTarget } from "@/components/budget/cover-overspending-popup";
import type { BudgetData, BudgetViewItem } from "@/lib/budget/types";
import { HomeCategoryRow } from "./home-card";

/**
 * Overspent list for the home screen. Tapping an item's pill opens the same
 * Cover Overspending popup as the budget screen, instead of sending the user
 * to /budget to find the category and tap it there.
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
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id}>
            <HomeCategoryRow
              name={item.name}
              groupName={item.isGroup ? "Group budget" : item.groupName}
              trailing={
                <button
                  type="button"
                  onClick={() => setTarget(item)}
                  aria-label={`Cover overspending in ${item.name}`}
                  className="-my-2 flex min-h-tap shrink-0 items-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <AvailablePill cents={item.availableCents} />
                </button>
              }
            />
          </li>
        ))}
      </ul>
      {coverTarget && (
        <CoverOverspendingPopup data={data} target={coverTarget} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
