"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { reorderCategories, reorderGroups } from "@/app/(app)/budget/actions";
import type { BudgetGroup } from "@/lib/budget/types";

type RCategory = { id: string; name: string };
type RGroup = { id: string; name: string; categories: RCategory[] };

// Drag-and-drop reorder mode for the Plan page. Groups are sortable globally;
// categories are sortable within their own group. Order is applied optimistically
// then persisted via reorderGroups / reorderCategories.
export function BudgetReorder({ groups }: { groups: BudgetGroup[] }) {
  const [items, setItems] = useState<RGroup[]>(() =>
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      categories: g.categories
        .filter((c) => c.role !== "ready_to_assign" && !c.isHidden)
        .map((c) => ({ id: c.id, name: c.name })),
    })),
  );
  const [, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleGroupDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((g) => g.id === active.id);
      const newIndex = prev.findIndex((g) => g.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      startTransition(async () => {
        await reorderGroups(next.map((g) => g.id));
      });
      return next;
    });
  }

  function handleCategoryDragEnd(groupId: string, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const oldIndex = g.categories.findIndex((c) => c.id === active.id);
        const newIndex = g.categories.findIndex((c) => c.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return g;
        const cats = arrayMove(g.categories, oldIndex, newIndex);
        startTransition(async () => {
          await reorderCategories(groupId, cats.map((c) => c.id));
        });
        return { ...g, categories: cats };
      }),
    );
  }

  return (
    <div className="pb-8">
      <p className="px-4 py-2 text-xs text-muted-foreground bg-muted/20 border-b">
        Drag the handles to reorder groups and categories.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGroupDragEnd}
      >
        <SortableContext
          items={items.map((g) => g.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((group) => (
            <SortableGroupBlock
              key={group.id}
              group={group}
              onCategoryDragEnd={handleCategoryDragEnd}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableGroupBlock({
  group,
  onCategoryDragEnd,
}: {
  group: RGroup;
  onCategoryDragEnd: (groupId: string, e: DragEndEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-b", isDragging && "opacity-50 relative z-10")}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/40 text-sm font-medium">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label="Drag group"
        >
          <GripVertical size={16} />
        </button>
        <span className="truncate">{group.name}</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => onCategoryDragEnd(group.id, e)}
      >
        <SortableContext
          items={group.categories.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.categories.map((cat) => (
            <SortableCategoryRow key={cat.id} cat={cat} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCategoryRow({ cat }: { cat: RCategory }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cat.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 pl-8 pr-3 py-2 border-b text-sm bg-background",
        isDragging && "opacity-50 relative z-10",
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        aria-label="Drag category"
      >
        <GripVertical size={14} />
      </button>
      <span className="truncate">{cat.name}</span>
    </div>
  );
}
