"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { previewImport, confirmImport, type ImportPreview } from "@/app/(app)/import/actions";
import type { AccountType } from "@/lib/ledger/types";
import type {
  AccountResolution,
  CategoryResolution,
  ImportSummary,
} from "@/lib/ynab-import/run";

type AccountChoice =
  | { action: "create"; type: AccountType }
  | { action: "existing"; accountId: string }
  | { action: "skip" };

function selectClass() {
  return cn(
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm",
    "focus:outline-none focus:ring-1 focus:ring-ring",
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function YnabImportWizard() {
  const [step, setStep] = useState<"upload" | "mapping" | "done">("upload");
  const [registerText, setRegisterText] = useState("");
  const [planText, setPlanText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [accountChoices, setAccountChoices] = useState<Record<string, AccountChoice>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleUpload(registerFile: File | null, planFile: File | null) {
    setError(null);
    if (!registerFile || !planFile) {
      setError("Both Register.csv and Plan.csv are required.");
      return;
    }
    const [regText, planTxt] = await Promise.all([
      readFileAsText(registerFile),
      readFileAsText(planFile),
    ]);
    setRegisterText(regText);
    setPlanText(planTxt);

    startTransition(async () => {
      const result = await previewImport(regText, planTxt);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);

      const initialAccountChoices: Record<string, AccountChoice> = {};
      for (const c of result.preview.accountCandidates) {
        if (c.existingMatch) {
          initialAccountChoices[c.csvName] = { action: "existing", accountId: c.existingMatch.id };
        } else if (c.looksOffBudget) {
          initialAccountChoices[c.csvName] = { action: "skip" };
        } else {
          initialAccountChoices[c.csvName] = { action: "create", type: "checking" };
        }
      }
      setAccountChoices(initialAccountChoices);
      setStep("mapping");
    });
  }

  function handleConfirm() {
    if (!preview) return;
    setError(null);

    const accountResolutions: AccountResolution[] = preview.accountCandidates.map((c) => {
      const choice = accountChoices[c.csvName];
      if (choice.action === "skip") return { csvName: c.csvName, action: "skip" };
      if (choice.action === "existing") {
        return { csvName: c.csvName, action: "existing", accountId: choice.accountId };
      }
      return { csvName: c.csvName, action: "create", type: choice.type };
    });

    const categoryResolutions: CategoryResolution[] = preview.categoryCandidates.map((c) =>
      c.existingCategoryMatch
        ? {
            categoryGroup: c.categoryGroup,
            category: c.category,
            action: "existing",
            categoryId: c.existingCategoryMatch.categoryId,
          }
        : {
            categoryGroup: c.categoryGroup,
            category: c.category,
            action: "create",
            existingGroupId: c.existingGroupMatch?.groupId,
          },
    );

    startTransition(async () => {
      const result = await confirmImport(
        registerText,
        planText,
        accountResolutions,
        categoryResolutions,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setStep("done");
    });
  }

  if (step === "upload") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload the two files from YNAB&apos;s &quot;Export Budget Data&quot; (Settings → Export). This
          is a one-time import — run it once, before linking any bank account or entering
          transactions manually.
        </p>
        <UploadForm onSubmit={handleUpload} isPending={isPending} />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  if (step === "mapping" && preview) {
    return (
      <div className="space-y-6">
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            {preview.counts.transactions} transactions, {preview.counts.transfers} transfers,{" "}
            {preview.counts.openingBalances} opening balances, {preview.counts.assignments} monthly
            assignments found.
          </p>
          {preview.counts.futureRowsSkipped > 0 && (
            <p>
              {preview.counts.futureRowsSkipped} row
              {preview.counts.futureRowsSkipped === 1 ? "" : "s"} dated after today (scheduled in
              YNAB) will be skipped — Crest reflects your balance as of today.
            </p>
          )}
          {preview.warnings.length > 0 && (
            <ul className="text-amber-600 dark:text-amber-500 list-disc pl-4">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>

        <section className="space-y-3">
          <h2 className="font-semibold text-sm">Accounts</h2>
          {preview.accountCandidates.map((c) => (
            <div key={c.csvName} className="flex items-center gap-3 border rounded-md p-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{c.csvName}</p>
                {c.looksOffBudget && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Looks like a YNAB Tracking (off-budget) account
                  </p>
                )}
              </div>
              <AccountChoiceControl
                candidate={c}
                choice={accountChoices[c.csvName]}
                existingAccounts={preview.existingAccounts}
                onChange={(choice) =>
                  setAccountChoices((prev) => ({ ...prev, [c.csvName]: choice }))
                }
              />
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-sm">Categories</h2>
          <p className="text-xs text-muted-foreground">
            Matched by exact name; anything unmatched is created automatically. Rename or merge
            categories in Crest afterward if needed.
          </p>
          {preview.categoryCandidates.map((c) => {
            const key = `${c.categoryGroup}||${c.category}`;
            const status = c.existingCategoryMatch
              ? "Matches existing category"
              : c.existingGroupMatch
                ? "Will create in existing group"
                : "Will create new group + category";
            return (
              <div key={key} className="flex items-center gap-3 border rounded-md p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {c.categoryGroup}: {c.category}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{status}</span>
              </div>
            );
          })}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleConfirm} disabled={isPending} className="w-full h-9">
          {isPending ? "Importing…" : "Run Import"}
        </Button>
      </div>
    );
  }

  if (step === "done" && summary) {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold text-sm">Import complete</h2>
        <ul className="text-sm space-y-1">
          <li>{summary.accountsCreated} accounts created</li>
          <li>
            {summary.groupsCreated} category groups and {summary.categoriesCreated} categories created
          </li>
          <li>
            {summary.transactionsCreated} transactions created, {summary.transactionsUpdated} updated
          </li>
          <li>{summary.transfersCreated} transfers created</li>
          <li>{summary.openingBalancesCreated} opening balances created</li>
          <li>{summary.assignmentsWritten} monthly assignments written</li>
          {summary.skippedAccounts.length > 0 && (
            <li>Skipped accounts: {summary.skippedAccounts.join(", ")}</li>
          )}
        </ul>
        {summary.errors.length > 0 && (
          <div>
            <p className="text-sm font-medium text-destructive">Errors</p>
            <ul className="text-xs text-destructive list-disc pl-4">
              {summary.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Next: reconcile each imported account against its real current balance (Accounts page),
          then link Plaid for ongoing bank sync.
        </p>
      </div>
    );
  }

  return null;
}

function UploadForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (registerFile: File | null, planFile: File | null) => void;
  isPending: boolean;
}) {
  const [registerFile, setRegisterFile] = useState<File | null>(null);
  const [planFile, setPlanFile] = useState<File | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Register.csv</Label>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setRegisterFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Plan.csv</Label>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </div>
      <Button
        onClick={() => onSubmit(registerFile, planFile)}
        disabled={isPending}
        className="h-9"
      >
        {isPending ? "Parsing…" : "Continue"}
      </Button>
    </div>
  );
}

function AccountChoiceControl({
  candidate,
  choice,
  existingAccounts,
  onChange,
}: {
  candidate: ImportPreview["accountCandidates"][number];
  choice: AccountChoice;
  existingAccounts: ImportPreview["existingAccounts"];
  onChange: (choice: AccountChoice) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        className={selectClass()}
        value={choice.action}
        onChange={(e) => {
          const action = e.target.value as AccountChoice["action"];
          if (action === "create") onChange({ action: "create", type: "checking" });
          else if (action === "skip") onChange({ action: "skip" });
          else {
            const first = existingAccounts[0];
            onChange({ action: "existing", accountId: first?.id ?? "" });
          }
        }}
      >
        <option value="create">Create new</option>
        <option value="existing">Map to existing</option>
        <option value="skip">Skip</option>
      </select>

      {choice.action === "create" && (
        <select
          className={selectClass()}
          value={choice.type}
          onChange={(e) => onChange({ action: "create", type: e.target.value as AccountType })}
        >
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="credit">Credit</option>
        </select>
      )}

      {choice.action === "existing" && (
        <select
          className={selectClass()}
          value={choice.accountId}
          onChange={(e) => onChange({ action: "existing", accountId: e.target.value })}
        >
          {existingAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      {candidate.existingMatch && choice.action === "existing" && (
        <span className="text-xs text-muted-foreground shrink-0">exact match</span>
      )}
    </div>
  );
}

