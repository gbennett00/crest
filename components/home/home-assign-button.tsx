"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AssignPopup } from "@/components/budget/assign-popup";
import type { BudgetData } from "@/components/budget/budget-screen";

export function HomeAssignButton({ data }: { data: BudgetData }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Assign
      </Button>
      {open && <AssignPopup data={data} onClose={() => setOpen(false)} />}
    </>
  );
}
