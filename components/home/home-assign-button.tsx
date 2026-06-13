"use client";

import { useState } from "react";
import { AssignPopup } from "@/components/budget/assign-popup";
import type { BudgetData } from "@/components/budget/budget-screen";

export function HomeAssignButton({ data }: { data: BudgetData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1 rounded-full shrink-0"
      >
        Assign
      </button>
      {open && <AssignPopup data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
