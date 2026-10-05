"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, ChevronRight, GripVertical } from "lucide-react";
import { reorderRulesAction } from "@/app/(app)/rules/actions";
import { describeRuleConditions } from "@/lib/category-rules/logic";
import type { RuleListRow } from "@/app/api/rules/route";
import { cn } from "@/lib/utils";

/**
 * The plan's rules in match order — checked top to bottom, first match wins.
 * Drag a row's handle to change the order; it's applied optimistically and
 * saved (which also re-applies suggestions to pending transactions).
 */
export function RuleList({
  rules,
  onEdit,
  onReordered,
}: {
  rules: RuleListRow[];
  onEdit: (rule: RuleListRow) => void;
  onReordered: (result: { error?: string; updatedPending?: number }) => void;
}) {
  // Local copy so a drag shows its new order immediately. Whenever fresh
  // rules arrive (a refetch after any edit, reorder or delete), they replace
  // it — reset during render rather than via key/remount, so an edit that
  // keeps the same ids (amount, category, …) still shows up.
  const [items, setItems] = useState(rules);
  const [lastRules, setLastRules] = useState(rules);
  if (rules !== lastRules) {
    setLastRules(rules);
    setItems(rules);
  }
  const [isPending, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((r) => r.id === active.id);
    const newIndex = items.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = items;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    startTransition(async () => {
      const result = await reorderRulesAction(next.map((r) => r.id));
      if (result.error !== undefined) setItems(previous);
      onReordered(result);
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((r) => r.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn("divide-y rounded-lg border", isPending && "opacity-70")}>
          {items.map((rule) => (
            <SortableRuleRow key={rule.id} rule={rule} onEdit={onEdit} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRuleRow({
  rule,
  onEdit,
}: {
  rule: RuleListRow;
  onEdit: (rule: RuleListRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });
  const conditions = describeRuleConditions(rule, rule.accountName);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-stretch bg-background", isDragging && "opacity-50 relative z-10")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none pl-3 pr-1 text-muted-foreground hover:text-foreground"
        aria-label={`Reorder rule for ${rule.matchText}`}
      >
        <GripVertical size={16} />
      </button>
      <button
        type="button"
        onClick={() => onEdit(rule)}
        className="min-w-0 flex-1 text-left pl-1 pr-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
      >
        <div className="min-w-0 flex-1">
          {/* The category matters most: it never truncates before the payee. */}
          <p className="text-sm font-medium flex items-center gap-1.5 min-w-0">
            {/* match_text is stored normalized (lowercase); display it title-cased. */}
            <span className="truncate capitalize">{rule.matchText}</span>
            <span className="text-muted-foreground font-normal shrink-0" aria-hidden>
              →
            </span>
            <span className="truncate shrink-0 max-w-[60%]">{rule.categoryName}</span>
          </p>
          {conditions && <p className="text-xs text-muted-foreground truncate">{conditions}</p>}
          {rule.categoryHidden && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1 mt-0.5">
              <AlertTriangle size={12} aria-hidden />
              Category is hidden — this rule is paused until you pick another or unhide it.
            </p>
          )}
        </div>
        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
      </button>
    </li>
  );
}
