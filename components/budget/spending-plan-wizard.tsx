"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import {
  listIncomeSources,
  applySpendingPlan,
  type SpendingPlanExpenseLineInput,
} from "@/app/(app)/budget/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import {
  computePlannedIncomeCents,
  targetNeedCents,
  totalTargetNeedCents,
} from "@/lib/budget/compute";
import { buildBudgetEntries } from "@/lib/budget/entries";
import type { BudgetData, TargetData } from "@/lib/budget/types";

// Guided flow that recreates a spreadsheet-style annual budget plan inside
// Crest: a list of income sources (informational only — see
// docs/budgeting-app-architecture.md, never feeds Ready to Assign) and a list
// of expense lines, each of which becomes a real category + target. Named
// "Spending Plan" (not "plan") to avoid colliding with the app's existing
// `plans` workspace concept.

type IncomeSourceDraft = {
  uid: string;
  id?: string;
  name: string;
  monthlyAmountCents: number;
};

type Cadence = "monthly" | "everyN" | "yearly";

type ExpenseLineDraft = {
  uid: string;
  categoryChoice: "existing" | "new";
  existingCategoryId: string;
  newCategoryName: string;
  // "" until a group is picked; "__new_group__" means "create a new group".
  newCategoryGroupId: string;
  newGroupName: string;
  newGroupBudgetMode: "category" | "group";
  cadence: Cadence;
  everyNMonths: number;
  amountCents: number;
  targetType: "fill_up_to" | "set_aside";
  targetDate: string;
  fundInFullNow: boolean;
};

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `draft-${uidCounter}`;
}

function emptyIncomeSource(): IncomeSourceDraft {
  return { uid: nextUid(), name: "", monthlyAmountCents: 0 };
}

function defaultTargetDate(monthsOut: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsOut);
  return d.toISOString().slice(0, 10);
}

function emptyExpenseLine(): ExpenseLineDraft {
  return {
    uid: nextUid(),
    categoryChoice: "existing",
    existingCategoryId: "",
    newCategoryName: "",
    newCategoryGroupId: "",
    newGroupName: "",
    newGroupBudgetMode: "category",
    cadence: "monthly",
    everyNMonths: 6,
    amountCents: 0,
    targetType: "set_aside",
    targetDate: defaultTargetDate(6),
    fundInFullNow: false,
  };
}

/** The TargetData this line would produce, for local need/leftover math. */
function draftTargetData(line: ExpenseLineDraft): TargetData {
  if (line.cadence === "monthly") {
    return {
      type: line.targetType,
      amountCents: line.amountCents,
      targetDate: null,
      repeatIntervalMonths: null,
    };
  }
  return {
    type: "by_date",
    amountCents: line.amountCents,
    targetDate: line.targetDate || defaultTargetDate(line.cadence === "yearly" ? 12 : line.everyNMonths),
    repeatIntervalMonths: line.cadence === "yearly" ? 12 : line.everyNMonths,
  };
}

function lineError(line: ExpenseLineDraft): string | null {
  if (line.categoryChoice === "existing" && !line.existingCategoryId) return "Pick a category";
  if (line.categoryChoice === "new") {
    if (!line.newCategoryName.trim()) return "Category name is required";
    if (!line.newCategoryGroupId) return "Pick or create a group";
    if (line.newCategoryGroupId === "__new_group__" && !line.newGroupName.trim())
      return "Group name is required";
  }
  if (line.amountCents <= 0) return "Enter an amount";
  if (line.cadence !== "monthly" && !line.targetDate) return "Due date is required";
  return null;
}

function toServerLine(line: ExpenseLineDraft): SpendingPlanExpenseLineInput {
  const target = draftTargetData(line);
  const category: SpendingPlanExpenseLineInput["category"] =
    line.categoryChoice === "existing"
      ? { kind: "existing", id: line.existingCategoryId }
      : line.newCategoryGroupId === "__new_group__"
        ? {
            kind: "newGroup",
            name: line.newCategoryName.trim(),
            newGroupName: line.newGroupName.trim(),
            newGroupBudgetMode: line.newGroupBudgetMode,
          }
        : { kind: "new", name: line.newCategoryName.trim(), groupId: line.newCategoryGroupId };

  return {
    category,
    type: target.type,
    amountCents: target.amountCents,
    targetDate: target.targetDate,
    repeatIntervalMonths: target.repeatIntervalMonths,
    fundInFullNow: line.fundInFullNow,
  };
}

/** Normalized monthly-equivalent cost, so lines on different cadences can be
 * compared/summed at a glance in the summary row. */
function lineMonthlyEquivalentCents(line: ExpenseLineDraft): number {
  if (line.cadence === "monthly") return line.amountCents;
  const intervalMonths = line.cadence === "yearly" ? 12 : line.everyNMonths;
  return Math.round(line.amountCents / intervalMonths);
}

/** The category (and, for a not-yet-created one, its group) this line will
 * land in, for display in the summary row. */
function lineCategoryLabel(
  line: ExpenseLineDraft,
  flatCategories: { id: string; name: string; groupId: string; groupName: string }[],
  groups: BudgetData["groups"],
): { name: string; groupName: string } {
  if (line.categoryChoice === "existing") {
    const cat = flatCategories.find((c) => c.id === line.existingCategoryId);
    return cat ? { name: cat.name, groupName: cat.groupName } : { name: "Select a category…", groupName: "" };
  }
  const name = line.newCategoryName.trim() || "New category";
  if (line.newCategoryGroupId === "__new_group__") {
    return { name, groupName: `${line.newGroupName.trim() || "New group"} (new)` };
  }
  const group = groups.find((g) => g.id === line.newCategoryGroupId);
  return { name, groupName: group ? group.name : "Select a group…" };
}

/** Mirrors the server's group-budgeted-group substitution (see
 * applySpendingPlan) for the review step's local estimate. */
function resolveExistingEntity(
  data: BudgetData,
  categoryId: string,
): { key: string; assignedCents: number; availableCents: number } | null {
  for (const g of data.groups) {
    const cat = g.categories.find((c) => c.id === categoryId);
    if (!cat) continue;
    if (g.budgetMode === "group") {
      return { key: `g:${g.id}`, assignedCents: g.groupAssignedCents, availableCents: g.groupAvailableCents };
    }
    return { key: `c:${cat.id}`, assignedCents: cat.assignedCents, availableCents: cat.availableCents };
  }
  return null;
}

/** The target this line would write to, as a stable key comparable across
 * lines — `c:<categoryId>` or `g:<groupId>` (a category in a group-budgeted
 * group can't hold its own target; the group is the funding unit, mirroring
 * applySpendingPlan's server-side substitution). Null when the line hasn't
 * settled on a category yet, or can't possibly collide with another line
 * (a brand-new category in a category-budgeted group always gets its own
 * fresh target). Used to stop two lines from silently overwriting the same
 * target — each category (or group-budgeted group) can only have one. */
function lineEntityKey(line: ExpenseLineDraft, data: BudgetData): string | null {
  if (line.categoryChoice === "existing") {
    if (!line.existingCategoryId) return null;
    return resolveExistingEntity(data, line.existingCategoryId)?.key ?? null;
  }
  if (!line.newCategoryGroupId || line.newCategoryGroupId === "__new_group__") return null;
  const group = data.groups.find((g) => g.id === line.newCategoryGroupId);
  return group?.budgetMode === "group" ? `g:${group.id}` : null;
}

function duplicateCategoryError(
  line: ExpenseLineDraft,
  allLines: ExpenseLineDraft[],
  data: BudgetData,
): string | null {
  const mine = lineEntityKey(line, data);
  if (!mine) return null;
  const collides = allLines.some(
    (other) => other.uid !== line.uid && lineEntityKey(other, data) === mine,
  );
  if (!collides) return null;
  return mine.startsWith("g:")
    ? "Another expense already targets this group"
    : "Another expense already uses this category";
}

/** Combines field-level validation with the one-target-per-category/group
 * check above — the single source of truth for whether a line is savable. */
function computeLineError(
  line: ExpenseLineDraft,
  allLines: ExpenseLineDraft[],
  data: BudgetData,
): string | null {
  return lineError(line) ?? duplicateCategoryError(line, allLines, data);
}

/** Existing categories still available to `line` — excludes any category (or,
 * for a group-budgeted group, any of its sibling categories) already claimed
 * by another line, so a duplicate can't be picked in the first place. */
function availableCategoriesFor(
  line: ExpenseLineDraft,
  allLines: ExpenseLineDraft[],
  data: BudgetData,
  all: { id: string; name: string; groupId: string; groupName: string }[],
): typeof all {
  const usedKeys = new Set(
    allLines
      .filter((l) => l.uid !== line.uid)
      .map((l) => lineEntityKey(l, data))
      .filter((k): k is string => !!k),
  );
  return all.filter((c) => {
    const key = resolveExistingEntity(data, c.id)?.key;
    return !key || !usedKeys.has(key);
  });
}

function selectClass() {
  return cn(
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm h-9",
    "focus:outline-none focus:ring-1 focus:ring-ring",
  );
}

/**
 * A plain decimal-typing dollar input, deliberately not the digit-shift
 * CurrencyInput used elsewhere (components/ui/currency-input.tsx). Target
 * amounts here are round dollars almost all the time — the rare exception
 * (an even split like $16.67) is something you'd type a period for, not
 * something worth optimizing every keystroke around.
 */
function DecimalAmountInput({
  cents,
  onCentsChange,
  className,
}: {
  cents: number;
  onCentsChange: (cents: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(() => (cents === 0 ? "" : (cents / 100).toString()));
  const [focused, setFocused] = useState(false);

  // Stay in sync with external resets (e.g. a fresh line) without fighting
  // the user's own typing while focused.
  useEffect(() => {
    if (!focused) setText(cents === 0 ? "" : (cents / 100).toString());
  }, [cents, focused]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder="0.00"
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d{0,2}$/.test(raw)) return; // reject a 3rd decimal digit, extra dots, non-digits
        setText(raw);
        const parsed = parseFloat(raw);
        onCentsChange(Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
      }}
    />
  );
}

export function SpendingPlanWizard({
  data,
  onClose,
}: {
  data: BudgetData;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formatCents = useFormattedCents();
  const [step, setStep] = useState<"income" | "expenses" | "review">("income");
  const [incomeSources, setIncomeSources] = useState<IncomeSourceDraft[]>([]);
  const [loadingIncome, setLoadingIncome] = useState(true);
  const [expenseLines, setExpenseLines] = useState<ExpenseLineDraft[]>([emptyExpenseLine()]);
  // The one expense line currently showing its full edit form; every other
  // line shows as a compact summary row so the whole plan stays scannable at
  // once, the way a spreadsheet would. Starts open on the first (empty) line.
  const [editingLineUid, setEditingLineUid] = useState<string | null>(
    () => expenseLines[0]?.uid ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    (async () => {
      const result = await listIncomeSources();
      if ("data" in result && result.data) {
        setIncomeSources(
          result.data.length
            ? result.data.map((s) => ({ uid: nextUid(), ...s }))
            : [emptyIncomeSource()],
        );
      } else {
        setIncomeSources([emptyIncomeSource()]);
      }
      setLoadingIncome(false);
    })();
  }, []);

  const plannedIncomeCents = computePlannedIncomeCents(incomeSources);

  function updateIncomeSource(uid: string, patch: Partial<IncomeSourceDraft>) {
    setIncomeSources((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  }
  function removeIncomeSource(uid: string) {
    setIncomeSources((prev) => prev.filter((s) => s.uid !== uid));
  }

  function updateLine(uid: string, patch: Partial<ExpenseLineDraft>) {
    setExpenseLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }
  function removeLine(uid: string) {
    setExpenseLines((prev) => prev.filter((l) => l.uid !== uid));
    setEditingLineUid((prev) => (prev === uid ? null : prev));
  }
  function addExpenseLine() {
    const line = emptyExpenseLine();
    setExpenseLines((prev) => [...prev, line]);
    setEditingLineUid(line.uid);
  }

  const flatCategories = data.groups.flatMap((g) =>
    g.categories
      .filter((c) => c.role !== "ready_to_assign")
      .map((c) => ({ id: c.id, name: c.name, groupId: g.id, groupName: g.name })),
  );

  // Existing budget entries not touched by a line in this run, so the review
  // total doesn't double-count a target this wizard is about to replace.
  const touchedKeys = new Set(
    expenseLines
      .filter((l) => l.categoryChoice === "existing" && l.existingCategoryId)
      .map((l) => resolveExistingEntity(data, l.existingCategoryId)?.key)
      .filter((k): k is string => !!k),
  );
  const baseEntries = buildBudgetEntries(data).filter((e) => !touchedKeys.has(e.key));
  const baseNeedCents = totalTargetNeedCents(
    baseEntries.map((e) => ({
      target: e.target,
      assignedCents: e.originalAssigned,
      availableCents: e.currentAvailable,
    })),
    data.month,
  );

  const validLines = expenseLines.filter((l) => !computeLineError(l, expenseLines, data));
  const lineNeedCents = validLines.reduce((sum, line) => {
    const target = draftTargetData(line);
    const existing =
      line.categoryChoice === "existing"
        ? resolveExistingEntity(data, line.existingCategoryId)
        : null;
    const assignedCents = existing?.assignedCents ?? 0;
    const availableCents = line.fundInFullNow
      ? line.amountCents
      : (existing?.availableCents ?? 0);
    return sum + targetNeedCents(target, data.month, assignedCents, availableCents);
  }, 0);

  const totalNeedCents = baseNeedCents + lineNeedCents;
  const leftoverCents = plannedIncomeCents - totalNeedCents;
  const frontLoadCents = validLines
    .filter((l) => l.fundInFullNow)
    .reduce((sum, l) => sum + l.amountCents, 0);

  function handleSubmit() {
    setError(null);
    const badLine = expenseLines.map((l) => computeLineError(l, expenseLines, data)).find(Boolean);
    if (badLine) {
      setError(badLine);
      return;
    }

    startTransition(async () => {
      const result = await applySpendingPlan({
        incomeSources: incomeSources
          .filter((s) => s.name.trim())
          .map((s) => ({ id: s.id, name: s.name.trim(), monthlyAmountCents: s.monthlyAmountCents })),
        expenseLines: expenseLines.map(toServerLine),
        month: data.month,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      invalidateAllLedgerQueries(queryClient);
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Spending plan"
      className={step === "expenses" ? "max-w-2xl" : "max-w-lg"}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(["income", "expenses", "review"] as const).map((s, i) => (
            <span
              key={s}
              className={cn(
                "px-2 py-0.5 rounded-full border",
                step === s ? "border-primary text-primary font-medium" : "border-input",
              )}
            >
              {i + 1}. {s === "income" ? "Income" : s === "expenses" ? "Expenses" : "Review"}
            </span>
          ))}
        </div>

        {step === "income" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Informational only — used to show how much of your income is still
              unspoken-for below. It never affects Ready to Assign.
            </p>
            {loadingIncome ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-2">
                {incomeSources.map((s) => (
                  <div key={s.uid} className="flex items-center gap-2">
                    <Input
                      value={s.name}
                      onChange={(e) => updateIncomeSource(s.uid, { name: e.target.value })}
                      placeholder="e.g. Paycheck"
                      className="h-9 text-sm flex-1"
                    />
                    <CurrencyInput
                      cents={s.monthlyAmountCents}
                      onCentsChange={(c) => updateIncomeSource(s.uid, { monthlyAmountCents: c })}
                      className="h-9 text-sm w-28"
                    />
                    <button
                      type="button"
                      onClick={() => removeIncomeSource(s.uid)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove income source"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setIncomeSources((prev) => [...prev, emptyIncomeSource()])}
                >
                  <Plus size={14} /> Add income source
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t text-sm font-medium">
              <span>Total planned income</span>
              <span>{formatCents(plannedIncomeCents)}</span>
            </div>
            <div className="flex justify-end pt-1">
              <Button type="button" onClick={() => setStep("expenses")}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === "expenses" && (
          <div className="space-y-4">
            <div className="rounded-lg border overflow-hidden">
              <div className="max-h-[65vh] overflow-y-auto divide-y">
                {expenseLines.map((line, i) => {
                  const err = computeLineError(line, expenseLines, data);
                  return editingLineUid === line.uid ? (
                    <ExpenseLineEditor
                      key={line.uid}
                      line={line}
                      index={i}
                      groups={data.groups}
                      flatCategories={availableCategoriesFor(line, expenseLines, data, flatCategories)}
                      err={err}
                      onChange={(patch) => updateLine(line.uid, patch)}
                      onRemove={expenseLines.length > 1 ? () => removeLine(line.uid) : undefined}
                      onDone={() => setEditingLineUid(null)}
                    />
                  ) : (
                    <ExpenseLineSummary
                      key={line.uid}
                      line={line}
                      index={i}
                      flatCategories={flatCategories}
                      groups={data.groups}
                      err={err}
                      formatCents={formatCents}
                      onEdit={() => setEditingLineUid(line.uid)}
                      onRemove={expenseLines.length > 1 ? () => removeLine(line.uid) : undefined}
                    />
                  );
                })}
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addExpenseLine}>
              <Plus size={14} /> Add expense
            </Button>
            <div className="flex justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => setStep("income")}>
                Back
              </Button>
              <Button type="button" onClick={() => { setEditingLineUid(null); setStep("review"); }}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-3">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Planned income</span>
                <span>{formatCents(plannedIncomeCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total monthly target need</span>
                <span>{formatCents(totalNeedCents)}</span>
              </div>
              <div className="flex justify-between font-medium pt-1 border-t">
                <span>Leftover</span>
                <span className={leftoverCents < 0 ? "text-destructive" : ""}>
                  {formatCents(leftoverCents)}
                </span>
              </div>
              {leftoverCents < 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Your targets ask for more than your planned income covers this month.
                  That&rsquo;s okay if you have other funds, but worth a second look.
                </p>
              )}
            </div>

            {frontLoadCents > 0 && (
              <div className="space-y-1 text-sm border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assigned right now (fund in full)</span>
                  <span>{formatCents(frontLoadCents)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Current Ready to Assign</span>
                  <span>{formatCents(data.rtaAvailableCents)}</span>
                </div>
                {frontLoadCents > data.rtaAvailableCents && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    This is more than you currently have in Ready to Assign.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => setStep("expenses")}>
                Back
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                {isPending ? "Creating…" : "Create plan"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ExpenseLineEditor({
  line,
  index,
  groups,
  flatCategories,
  err,
  onChange,
  onRemove,
  onDone,
}: {
  line: ExpenseLineDraft;
  index: number;
  groups: BudgetData["groups"];
  flatCategories: { id: string; name: string; groupId: string; groupName: string }[];
  err: string | null;
  onChange: (patch: Partial<ExpenseLineDraft>) => void;
  onRemove?: () => void;
  onDone: () => void;
}) {
  const [showError, setShowError] = useState(false);

  function handleSave() {
    if (err) {
      setShowError(true);
      return;
    }
    onDone();
  }

  return (
    <div className="bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Expense {index + 1}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remove expense line"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Category</Label>
        <select
          className={selectClass()}
          value={line.categoryChoice === "existing" ? line.existingCategoryId : "__new__"}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              onChange({ categoryChoice: "new" });
            } else {
              onChange({ categoryChoice: "existing", existingCategoryId: e.target.value });
            }
          }}
        >
          <option value="">Select category…</option>
          {flatCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.groupName} / {c.name}
            </option>
          ))}
          <option value="__new__">+ New category…</option>
        </select>
      </div>

      {line.categoryChoice === "new" && (
        <div className="space-y-2 pl-3 border-l-2 border-muted">
          <Input
            value={line.newCategoryName}
            onChange={(e) => onChange({ newCategoryName: e.target.value })}
            placeholder="Category name"
            className="h-9 text-sm"
          />
          <select
            className={selectClass()}
            value={line.newCategoryGroupId}
            onChange={(e) => onChange({ newCategoryGroupId: e.target.value })}
          >
            <option value="">Select group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="__new_group__">+ New group…</option>
          </select>
          {line.newCategoryGroupId === "__new_group__" && (
            <div className="space-y-2">
              <Input
                value={line.newGroupName}
                onChange={(e) => onChange({ newGroupName: e.target.value })}
                placeholder="Group name"
                className="h-9 text-sm"
              />
              <div className="flex gap-2 text-xs">
                {(["category", "group"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChange({ newGroupBudgetMode: mode })}
                    className={cn(
                      "px-3 py-1.5 rounded border transition-colors",
                      line.newGroupBudgetMode === mode
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {mode === "category" ? "Per category" : "Group pool"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">How often</Label>
        <div className="flex gap-1">
          {(
            [
              ["monthly", "Monthly"],
              ["everyN", "Every N months"],
              ["yearly", "Yearly"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ cadence: value })}
              className={cn(
                "px-2 py-1 rounded text-xs border transition-colors",
                line.cadence === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1 flex-1">
          <Label className="text-xs text-muted-foreground">
            {line.cadence === "monthly"
              ? "$ per month"
              : line.cadence === "everyN"
                ? `$ every ${line.everyNMonths} months`
                : "$ per year"}
          </Label>
          <DecimalAmountInput
            cents={line.amountCents}
            onCentsChange={(c) => onChange({ amountCents: c })}
            className="h-9 text-sm"
          />
        </div>
        {line.cadence === "everyN" && (
          <div className="space-y-1 w-24">
            <Label className="text-xs text-muted-foreground">Every</Label>
            <select
              className={selectClass()}
              value={line.everyNMonths}
              onChange={(e) => onChange({ everyNMonths: Number(e.target.value) })}
            >
              {[2, 3, 4, 6].map((n) => (
                <option key={n} value={n}>
                  {n} mo
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {line.cadence === "monthly" ? (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Target type</Label>
          <div className="flex gap-1">
            {(["set_aside", "fill_up_to"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ targetType: t })}
                className={cn(
                  "px-2 py-1 rounded text-xs border transition-colors",
                  line.targetType === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {t === "fill_up_to" ? "Fill up to" : "Set aside"}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Next due date</Label>
            <Input
              type="date"
              value={line.targetDate}
              onChange={(e) => onChange({ targetDate: e.target.value })}
              className="h-9 text-sm block w-full appearance-none"
            />
          </div>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={line.fundInFullNow}
              onChange={(e) => onChange({ fundInFullNow: e.target.checked })}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              Fund this category in full now (assigns the whole amount this month from
              Ready to Assign, e.g. a vacation fund you draw from all year — replaces any
              existing assignment for this category this month). Leave unchecked to build
              up to the amount gradually (e.g. Christmas).
            </span>
          </label>
        </>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {showError && err ? (
          <p className="text-xs text-destructive">{err}</p>
        ) : (
          <span />
        )}
        <Button type="button" size="sm" className="shrink-0" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

function ExpenseLineSummary({
  line,
  index,
  flatCategories,
  groups,
  err,
  formatCents,
  onEdit,
  onRemove,
}: {
  line: ExpenseLineDraft;
  index: number;
  flatCategories: { id: string; name: string; groupId: string; groupName: string }[];
  groups: BudgetData["groups"];
  err: string | null;
  formatCents: (cents: number) => string;
  onEdit: () => void;
  onRemove?: () => void;
}) {
  const { name, groupName } = lineCategoryLabel(line, flatCategories, groups);
  const intervalMonths = line.cadence === "yearly" ? 12 : line.everyNMonths;

  return (
    <div className="px-3 py-1.5 flex items-center gap-2 hover:bg-muted/40">
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 flex items-center gap-2 text-left"
      >
        <span className="text-sm font-medium truncate">{name}</span>
        {groupName && (
          <span className="text-xs text-muted-foreground truncate shrink-0">{groupName}</span>
        )}
      </button>
      <div className="flex items-center gap-2 shrink-0">
        {err ? (
          <span className="text-xs text-destructive">{err}</span>
        ) : (
          <>
            {line.cadence !== "monthly" && (
              <span className="text-[10px] leading-none text-muted-foreground bg-muted rounded px-1.5 py-1 tabular-nums whitespace-nowrap">
                {formatCents(line.amountCents)}/{intervalMonths}mo
              </span>
            )}
            <span className="text-sm tabular-nums text-right shrink-0">
              {formatCents(lineMonthlyEquivalentCents(line))}/mo
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Edit expense ${index + 1}`}
        >
          <Pencil size={13} />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remove expense line"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
