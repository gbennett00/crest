"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { setActivePlan } from "@/app/(app)/members/actions";
import { cn } from "@/lib/utils";
import type { UserPlan } from "@/lib/plan/invitations";

export function PlanSwitcher({
  plans,
  activePlanId,
  onSwitched,
}: {
  plans: UserPlan[];
  activePlanId: string;
  onSwitched?: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function switchTo(planId: string) {
    if (planId === activePlanId) return;
    startTransition(async () => {
      const result = await setActivePlan(planId);
      if (!result?.error) onSwitched?.();
    });
  }

  return (
    <ul className="divide-y rounded-lg border">
      {plans.map((plan) => {
        const active = plan.planId === activePlanId;
        return (
          <li key={plan.planId} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{plan.name}</p>
              <p className="text-xs text-muted-foreground">
                {plan.role === "owner" ? "You created this plan" : "Shared with you"}
              </p>
            </div>
            {active ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                <Check size={14} /> Active
              </span>
            ) : (
              <button
                onClick={() => switchTo(plan.planId)}
                disabled={isPending}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50",
                )}
              >
                Switch
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
