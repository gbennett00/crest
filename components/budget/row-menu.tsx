"use client";

import { MoreVertical, Pencil, Target } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Per-row actions menu (rename + target). Stops click propagation so it doesn't
// trigger the row's navigation/popover behavior.
export function RowMenu({
  onRename,
  onEditTarget,
  hasTarget,
  showTarget = true,
}: {
  onRename: () => void;
  onEditTarget?: () => void;
  hasTarget: boolean;
  showTarget?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Row actions"
        >
          <MoreVertical size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onSelect={onRename} className="gap-2">
          <Pencil size={14} /> Rename
        </DropdownMenuItem>
        {showTarget && onEditTarget && (
          <DropdownMenuItem onSelect={onEditTarget} className="gap-2">
            <Target size={14} /> {hasTarget ? "Edit target" : "Set target"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
