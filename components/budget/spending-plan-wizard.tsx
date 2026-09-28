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
  effectiveTargetDate,
  repeatIntervalLabel,
  sinkingMonthlyContributionCents,
  TARGET_REPEAT_INTERVALS,
  targetMonthlyCostCents,
  totalTargetMonthlyCostCents,
} from "@/lib/budget/compute";
import { buildBudgetEntries } from "@/lib/budget/entries";
import type { BudgetData, TargetData } from "@/lib/budget/types";

// Guided flow that recreates a spreadsheet-style annual budget plan inside
// Crest: a list of income sources (informational only — see
// docs/budgeting-app-architecture.md, never feeds Ready to Assign) and a list
// of expense lines, each of which is a real category + target. It opens
// pre-loaded with every existing target (except one-time "by date" ones), so
// it edits the whole plan: removing a pre-loaded line deletes that target.
// Named "Spending Plan" (not "plan") to avoid colliding with the app's
// existing `plans` workspace concept.

type IncomeSourceDraft = {
  uid: string;
  id?: string;
  name: string;
  monthlyAmountCents: number;
};

// "monthly": set aside / fill up to an amount every month. "recurring": an
// amount every `intervalMonths`, either saved up in the category by a due
// date, or (sinking) needed at the start of each cycle and funded by hand
// from the shared Sinking Fund.
type Cadence = "monthly" | "recurring";
type RecurringKind = "by_date" | "sinking";

// A selectable existing target: either a category (in a category-budgeted
// group) or a whole group (in a group-budgeted group — see GROUP BUDGETING
// RULES in docs/budgeting-app-architecture.md). Individual categories inside
// a group-budgeted group are never independently targetable, so they're
// never offered — only the group itself is, matching what applySpendingPlan
// actually attaches the target to.
type PickableTarget = {
  id: string;
  name: string;
  groupName: string;
  kind: "category" | "group";
};

type ExpenseLineDraft = {
  uid: string;
  categoryChoice: "existing" | "new";
  // A category id (category-budgeted group) or a group id (group-budgeted
  // group) — see PickableTarget.
  existingCategoryId: string;
  newCategoryName: string;
  // "" until a group is picked; "__new_group__" means "create a new group".
  newCategoryGroupId: string;
  newGroupName: string;
  newGroupBudgetMode: "category" | "group";
  cadence: Cadence;
  intervalMonths: number;
  recurringKind: RecurringKind;
  amountCents: number;
  targetType: "fill_up_to" | "set_aside";
  targetDate: string;
};

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `draft-${uidCounter}`;
}

function emptyIncomeSource(): IncomeSourceDraft {
  return { uid: nextUid(), name: "", monthlyAmountCents: 0 };
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
    intervalMonths: 12,
    recurringKind: "by_date",
    amountCents: 0,
    targetType: "set_aside",
    targetDate: "",
  };
}

/** The target this line saves as. */
function draftTargetData(line: ExpenseLineDraft): TargetData {
  if (line.cadence === "monthly") {
    return {
      type: line.targetType,
      amountCents: line.amountCents,
      targetDate: null,
      repeatIntervalMonths: null,
    };
  }
  if (line.recurringKind === "sinking") {
    return {
      type: "sinking",
      amountCents: line.amountCents,
      targetDate: null,
      repeatIntervalMonths: line.intervalMonths,
    };
  }
  return {
    type: "by_date",
    amountCents: line.amountCents,
    targetDate: line.targetDate || null,
    repeatIntervalMonths: line.intervalMonths,
  };
}

/**
 * An existing target as a pre-loaded line, or null for a one-time "by date"
 * target (left out of the wizard, which plans recurring commitments). A
 * recurring due date is shown as its next occurrence.
 */
function targetToLine(entityId: string, target: TargetData, month: string): ExpenseLineDraft | null {
  const base: ExpenseLineDraft = {
    ...emptyExpenseLine(),
    existingCategoryId: entityId,
    amountCents: target.amountCents,
  };
  if (target.type === "set_aside" || target.type === "fill_up_to") {
    return { ...base, cadence: "monthly", targetType: target.type };
  }
  if (!target.repeatIntervalMonths) return null;
  if (target.type === "sinking") {
    return {
      ...base,
      cadence: "recurring",
      recurringKind: "sinking",
      intervalMonths: target.repeatIntervalMonths,
    };
  }
  return {
    ...base,
    cadence: "recurring",
    recurringKind: "by_date",
    intervalMonths: target.repeatIntervalMonths,
    targetDate: target.targetDate
      ? effectiveTargetDate(target.targetDate, target.repeatIntervalMonths, month)
      : "",
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
  if (line.cadence === "recurring" && line.recurringKind === "by_date" && !line.targetDate)
    return "Due date is required";
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
  };
}

/** The category/group (and, for a not-yet-created one, its group) this line
 * will land in, for display in the summary row. */
function lineCategoryLabel(
  line: ExpenseLineDraft,
  categoryOptions: PickableTarget[],
  groups: BudgetData["groups"],
): { name: string; groupName: string } {
  if (line.categoryChoice === "existing") {
    const picked = categoryOptions.find((t) => t.id === line.existingCategoryId);
    return picked
      ? { name: picked.name, groupName: picked.groupName }
      : { name: "Select a category…", groupName: "" };
  }
  const name = line.newCategoryName.trim() || "New category";
  if (line.newCategoryGroupId === "__new_group__") {
    return { name, groupName: `${line.newGroupName.trim() || "New group"} (new)` };
  }
  const group = groups.find((g) => g.id === line.newCategoryGroupId);
  return { name, groupName: group ? group.name : "Select a group…" };
}

/** Resolves an id from the category picker (a category id, or — for a
 * group-budgeted group — the group's own id, see PickableTarget) to the
 * funding unit it actually targets, mirroring the server's group-budgeted
 * substitution in applySpendingPlan. Returns just the stable key (`c:<id>`
 * or `g:<id>`) — this only needs to compare/dedupe entities, never their
 * current assigned/available (see targetMonthlyCostCents for why the
 * wizard's need math doesn't use those). */
function resolveEntityKey(data: BudgetData, id: string): string | null {
  const directGroup = data.groups.find((g) => g.id === id);
  if (directGroup?.budgetMode === "group") return `g:${directGroup.id}`;

  for (const g of data.groups) {
    const cat = g.categories.find((c) => c.id === id);
    if (!cat) continue;
    return g.budgetMode === "group" ? `g:${g.id}` : `c:${cat.id}`;
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
    return resolveEntityKey(data, line.existingCategoryId);
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
  all: PickableTarget[],
): PickableTarget[] {
  const usedKeys = new Set(
    allLines
      .filter((l) => l.uid !== line.uid)
      .map((l) => lineEntityKey(l, data))
      .filter((k): k is string => !!k),
  );
  return all.filter((t) => {
    const key = resolveEntityKey(data, t.id);
    return !key || !usedKeys.has(key);
  });
}

/**
 * What a target can attach to: a group-budgeted group itself (never its
 * individual categories — see GROUP BUDGETING RULES), or a category in a
 * category-budgeted group. System categories (Ready to Assign, the Sinking
 * Fund) and credit card payment categories — whose available is derived from
 * the card's register (see CREDIT CARD LOGIC) — are never offered.
 */
function buildCategoryOptions(data: BudgetData): PickableTarget[] {
  return data.groups.flatMap((g): PickableTarget[] => {
    if (g.budgetMode === "group") {
      return [{ id: g.id, name: g.name, groupName: "Group budget", kind: "group" }];
    }
    return g.categories
      .filter((c) => c.role === null && !c.isPaymentCategory)
      .map((c) => ({ id: c.id, name: c.name, groupName: g.name, kind: "category" }));
  });
}

/** Every existing target the wizard edits, as lines, plus the entities they
 * came from (so a line the user deletes can have its target removed). */
function buildInitialLines(data: BudgetData): {
  lines: ExpenseLineDraft[];
  preloaded: { key: string; type: "category" | "group"; id: string }[];
} {
  const targetById = new Map<string, TargetData>();
  for (const g of data.groups) {
    if (g.target) targetById.set(g.id, g.target);
    for (const c of g.categories) if (c.target) targetById.set(c.id, c.target);
  }

  const lines: ExpenseLineDraft[] = [];
  const preloaded: { key: string; type: "category" | "group"; id: string }[] = [];
  for (const option of buildCategoryOptions(data)) {
    const target = targetById.get(option.id);
    const line = target ? targetToLine(option.id, target, data.month) : null;
    if (!line) continue;
    lines.push(line);
    preloaded.push({
      key: `${option.kind === "group" ? "g" : "c"}:${option.id}`,
      type: option.kind,
      id: option.id,
    });
  }
  return { lines, preloaded };
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
  const [initial] = useState(() => {
    const built = buildInitialLines(data);
    return built.lines.length ? built : { ...built, lines: [emptyExpenseLine()] };
  });
  const [expenseLines, setExpenseLines] = useState<ExpenseLineDraft[]>(initial.lines);
  // The one expense line currently showing its full edit form; every other
  // line shows as a compact summary row so the whole plan stays scannable at
  // once, the way a spreadsheet would. Starts open only on a lone blank line.
  const [editingLineUid, setEditingLineUid] = useState<string | null>(() =>
    initial.preloaded.length ? null : (initial.lines[0]?.uid ?? null),
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

  const categoryOptions = buildCategoryOptions(data);

  // Targets on the page but not in this wizard's lines: one-time "by date"
  // targets and anything not offered in the picker. Excluded: entries that
  // are (or were pre-loaded as) lines — their cost comes from the lines, or
  // they're about to be deleted — and the Sinking Fund, whose derived target
  // is already counted as each sinking line's monthly share.
  const lineKeys = new Set(
    expenseLines.map((l) => lineEntityKey(l, data)).filter((k): k is string => !!k),
  );
  const preloadedKeys = new Set(initial.preloaded.map((p) => p.key));
  const sinkingFundKeys = new Set(
    data.groups
      .flatMap((g) => g.categories)
      .filter((c) => c.role === "sinking_fund")
      .map((c) => `c:${c.id}`),
  );
  const baseEntries = buildBudgetEntries(data).filter(
    (e) => !lineKeys.has(e.key) && !preloadedKeys.has(e.key) && !sinkingFundKeys.has(e.key),
  );
  // Steady-state monthly cost, not "how much more to assign this month" —
  // this must stay the same whether a category already has this month's
  // assignment done or not (see targetMonthlyCostCents).
  const baseNeedCents = totalTargetMonthlyCostCents(
    baseEntries.map((e) => ({ target: e.target })),
    data.month,
  );

  const validLines = expenseLines.filter((l) => !computeLineError(l, expenseLines, data));
  const lineNeedCents = validLines.reduce(
    (sum, line) => sum + targetMonthlyCostCents(draftTargetData(line), data.month),
    0,
  );
  const sinkingFundMonthlyCents = validLines.reduce(
    (sum, line) => sum + sinkingMonthlyContributionCents(draftTargetData(line)),
    0,
  );

  const totalNeedCents = baseNeedCents + lineNeedCents;
  const leftoverCents = plannedIncomeCents - totalNeedCents;

  function handleSubmit() {
    setError(null);
    const badLine = expenseLines.map((l) => computeLineError(l, expenseLines, data)).find(Boolean);
    if (badLine) {
      setError(badLine);
      return;
    }

    // Pre-loaded targets no line points at any more (deleted, or moved to a
    // different category) are removed.
    const removeTargets = initial.preloaded
      .filter((p) => !lineKeys.has(p.key))
      .map(({ type, id }) => ({ type, id }));

    startTransition(async () => {
      const result = await applySpendingPlan({
        incomeSources: incomeSources
          .filter((s) => s.name.trim())
          .map((s) => ({ id: s.id, name: s.name.trim(), monthlyAmountCents: s.monthlyAmountCents })),
        expenseLines: expenseLines.map(toServerLine),
        removeTargets,
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
                {expenseLines.length === 0 && (
                  <p className="px-3 py-3 text-sm text-muted-foreground">No expenses yet.</p>
                )}
                {expenseLines.map((line, i) => {
                  const err = computeLineError(line, expenseLines, data);
                  return editingLineUid === line.uid ? (
                    <ExpenseLineEditor
                      key={line.uid}
                      line={line}
                      index={i}
                      groups={data.groups}
                      categoryOptions={availableCategoriesFor(line, expenseLines, data, categoryOptions)}
                      err={err}
                      onChange={(patch) => updateLine(line.uid, patch)}
                      onRemove={() => removeLine(line.uid)}
                      onDone={() => setEditingLineUid(null)}
                    />
                  ) : (
                    <ExpenseLineSummary
                      key={line.uid}
                      line={line}
                      index={i}
                      categoryOptions={categoryOptions}
                      groups={data.groups}
                      err={err}
                      monthlyCents={targetMonthlyCostCents(draftTargetData(line), data.month)}
                      formatCents={formatCents}
                      onEdit={() => setEditingLineUid(line.uid)}
                      onRemove={() => removeLine(line.uid)}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addExpenseLine}>
                <Plus size={14} /> Add expense
              </Button>
              <span className={cn("text-sm", leftoverCents < 0 && "text-destructive")}>
                Available: {formatCents(leftoverCents)}
              </span>
            </div>
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

            {sinkingFundMonthlyCents > 0 && (
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="text-muted-foreground">Sinking Fund target</span>
                <span>{formatCents(sinkingFundMonthlyCents)}/mo</span>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => setStep("expenses")}>
                Back
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isPending}>
                {isPending ? "Saving…" : "Save plan"}
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
  categoryOptions,
  err,
  onChange,
  onRemove,
  onDone,
}: {
  line: ExpenseLineDraft;
  index: number;
  groups: BudgetData["groups"];
  categoryOptions: PickableTarget[];
  err: string | null;
  onChange: (patch: Partial<ExpenseLineDraft>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [showError, setShowError] = useState(false);

  // Monthly, then each offered interval — plus this line's own interval if it
  // came from a target set to one that isn't offered, so it isn't lost.
  const intervals: number[] = [...TARGET_REPEAT_INTERVALS];
  if (line.cadence === "recurring" && !intervals.includes(line.intervalMonths)) {
    intervals.push(line.intervalMonths);
  }
  const cadenceChoices = [
    { key: "monthly", label: "Monthly", intervalMonths: null, selected: line.cadence === "monthly" },
    ...intervals.map((n) => ({
      key: String(n),
      label: repeatIntervalLabel(n),
      intervalMonths: n,
      selected: line.cadence === "recurring" && line.intervalMonths === n,
    })),
  ];

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
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remove expense line"
        >
          <Trash2 size={14} />
        </button>
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
          {categoryOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.kind === "group" ? `${t.name} (group budget)` : `${t.groupName} / ${t.name}`}
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
        <div className="flex gap-1 flex-wrap">
          {cadenceChoices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              onClick={() =>
                onChange(
                  choice.intervalMonths === null
                    ? { cadence: "monthly" }
                    : { cadence: "recurring", intervalMonths: choice.intervalMonths },
                )
              }
              className={cn(
                "px-2 py-1 rounded text-xs border transition-colors",
                choice.selected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          {line.cadence === "monthly"
            ? "$ per month"
            : line.intervalMonths === 12
              ? "$ per year"
              : `$ every ${line.intervalMonths} months`}
        </Label>
        <DecimalAmountInput
          cents={line.amountCents}
          onCentsChange={(c) => onChange({ amountCents: c })}
          className="h-9 text-sm"
        />
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
            <Label className="text-xs text-muted-foreground">Funding</Label>
            <div className="flex gap-1">
              {(["by_date", "sinking"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChange({ recurringKind: kind })}
                  className={cn(
                    "px-2 py-1 rounded text-xs border transition-colors",
                    line.recurringKind === kind
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input bg-background hover:bg-muted",
                  )}
                >
                  {kind === "by_date" ? "Save up by a due date" : "Sinking fund"}
                </button>
              ))}
            </div>
          </div>
          {line.recurringKind === "by_date" ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Next due date</Label>
              <Input
                type="date"
                value={line.targetDate}
                onChange={(e) => onChange({ targetDate: e.target.value })}
                className="h-9 text-sm block w-full appearance-none"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              You need the full amount at the start of each cycle. The Sinking Fund&rsquo;s
              target goes up by this amount ÷ {line.intervalMonths} each month; moving money
              into this category is up to you.
            </p>
          )}
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
  categoryOptions,
  groups,
  err,
  monthlyCents,
  formatCents,
  onEdit,
  onRemove,
}: {
  line: ExpenseLineDraft;
  index: number;
  categoryOptions: PickableTarget[];
  groups: BudgetData["groups"];
  err: string | null;
  monthlyCents: number;
  formatCents: (cents: number) => string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { name, groupName } = lineCategoryLabel(line, categoryOptions, groups);

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
            {line.cadence === "recurring" && (
              <span className="text-[10px] leading-none text-muted-foreground bg-muted rounded px-1.5 py-1 tabular-nums whitespace-nowrap">
                {formatCents(line.amountCents)}/{line.intervalMonths}mo
                {line.recurringKind === "sinking" && " · sinking fund"}
              </span>
            )}
            <span className="text-sm tabular-nums text-right shrink-0">
              {formatCents(monthlyCents)}/mo
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
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remove expense line"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
