import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bulkUpsertCategoryBudgets,
  bulkUpsertTransactions,
  claimPlaidTransaction,
  createAccount,
  createOpeningBalance,
  createTransfer,
  getAccount,
  getReadyToAssignCategoryId,
  OPENING_BALANCE_IMPORTED_ID,
} from "@/lib/ledger";
import type {
  AccountType,
  TransactionAllocationInput,
  UpsertCategoryBudgetInput,
  UpsertTransactionInput,
} from "@/lib/ledger/types";
import { selectAdoptionMatch, type AdoptionCandidate } from "@/lib/plaid/match";
import { chunk, mapWithConcurrency } from "./concurrency";
import { isCreditCardPaymentCategory, isReadyToAssignCategory } from "./mapping";
import type { ParsedTransaction, ParsedTransfer, PlanParseResult, RegisterParseResult } from "./types";

/**
 * How many transfer/opening-balance writes run concurrently. Those still go
 * through the single-row RPCs (createTransfer/createOpeningBalance) — there
 * are typically only a handful of each, so it wasn't worth building bulk
 * variants for them (see the transactions/assignments batching below instead).
 */
const CONCURRENCY = 20;

/**
 * Transactions and assignments go through bulkUpsertTransactions/
 * bulkUpsertCategoryBudgets — one HTTP round trip per BATCH_SIZE rows instead
 * of per row, which is what actually cuts down the number of requests for a
 * large import (concurrency alone just runs more single-row requests at once).
 * BATCH_CONCURRENCY batches run at once on top of that. Both are tunable if
 * your Supabase project's connection pool comfortably handles more.
 */
const BATCH_SIZE = 50;
const BATCH_CONCURRENCY = 5;
/** How many rows to name in a batch-failure error before truncating. */
const MAX_ROWS_NAMED_IN_ERROR = 10;

function describeBatchFailure(label: string, batch: { label: string }[], e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const shown = batch.slice(0, MAX_ROWS_NAMED_IN_ERROR).map((p) => p.label);
  const suffix = batch.length > MAX_ROWS_NAMED_IN_ERROR ? ` (+${batch.length - MAX_ROWS_NAMED_IN_ERROR} more)` : "";
  return `Batch of ${batch.length} ${label} failed, none were written: ${message}. Rows: ${shown.join(", ")}${suffix}`;
}

export type AccountResolution =
  | { csvName: string; action: "skip" }
  | { csvName: string; action: "existing"; accountId: string }
  | { csvName: string; action: "create"; type: AccountType };

export type CategoryResolution =
  | { categoryGroup: string; category: string; action: "existing"; categoryId: string }
  | { categoryGroup: string; category: string; action: "create"; existingGroupId?: string };

export type ImportInput = {
  register: RegisterParseResult;
  plan: PlanParseResult;
  planId: string;
  accountResolutions: AccountResolution[];
  categoryResolutions: CategoryResolution[];
};

export type ImportSummary = {
  accountsCreated: number;
  groupsCreated: number;
  categoriesCreated: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  /** Register rows matched to an existing Plaid-imported transaction and categorized onto it instead of duplicated — see loadClaimablePlaidTransactions. */
  transactionsMatchedToPlaid: number;
  transfersCreated: number;
  openingBalancesCreated: number;
  assignmentsWritten: number;
  skippedAccounts: string[];
  errors: string[];
};

type ResolvedAccount = { accountId: string; paymentCategoryId: string | null };

function hashTransaction(t: ParsedTransaction): string {
  // memo is deliberately excluded so editing a transaction's memo in YNAB and
  // re-exporting updates the existing row instead of creating a duplicate.
  const payload = `${t.account}|${t.date}|${t.payee}|${t.amountCents}|${t.dedupeIndex}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function hashTransfer(t: ParsedTransfer): string {
  const payload = `${t.fromAccount}|${t.toAccount}|${t.date}|${t.amountCents}|${t.dedupeIndex}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Loads, per account, existing transactions that already carry a real
 * external id — not a YNAB CSV hash (`csv:...`) and not the opening-balance
 * marker — i.e. Plaid-imported rows. A register row whose account, amount,
 * and date land within selectAdoptionMatch's window of one of these is the
 * same real-world purchase Plaid already reported (e.g. Plaid was linked and
 * synced history before this CSV was uploaded); claimPlaidTransaction applies
 * its categorization to that row instead of runImport inserting a second,
 * duplicate transaction. This is the reverse of loadAdoptionCandidates in
 * lib/plaid/sync.ts, which handles the same overlap when Plaid syncs second.
 */
async function loadClaimablePlaidTransactions(
  client: SupabaseClient,
  accountIds: string[],
): Promise<Map<string, AdoptionCandidate[]>> {
  const pools = new Map<string, AdoptionCandidate[]>();
  if (accountIds.length === 0) return pools;

  const { data, error } = await client
    .from("transactions")
    .select("id, account_id, amount_cents, txn_date")
    .in("account_id", accountIds)
    .not("imported_id", "is", null)
    .not("imported_id", "like", "csv:%")
    .neq("imported_id", OPENING_BALANCE_IMPORTED_ID);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const accountId = row.account_id as string;
    const pool = pools.get(accountId) ?? [];
    pool.push({
      id: row.id as string,
      amountCents: row.amount_cents as number,
      txnDate: row.txn_date as string,
    });
    pools.set(accountId, pool);
  }

  return pools;
}

/** Mirrors createManualAccount's credit-card-payment-category provisioning (app/(app)/accounts/actions.ts). */
async function findOrCreateCreditPaymentCategory(
  client: SupabaseClient,
  planId: string,
  accountName: string,
): Promise<string> {
  const { data: existingGroup } = await client
    .from("category_groups")
    .select("id")
    .eq("name", "Credit Cards")
    .maybeSingle();

  let groupId: string;
  if (existingGroup) {
    groupId = existingGroup.id as string;
  } else {
    const { data: newGroup, error } = await client
      .from("category_groups")
      .insert({ name: "Credit Cards", budget_mode: "category", plan_id: planId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    groupId = (newGroup as { id: string }).id;
  }

  const { data: cat, error: catErr } = await client
    .from("categories")
    .insert({ name: `${accountName} Payment`, group_id: groupId })
    .select("id")
    .single();
  if (catErr) throw new Error(catErr.message);
  return (cat as { id: string }).id;
}

async function resolveAccounts(
  client: SupabaseClient,
  planId: string,
  resolutions: AccountResolution[],
): Promise<{
  accountMap: Map<string, ResolvedAccount>;
  skippedAccounts: string[];
  accountsCreated: number;
}> {
  const accountMap = new Map<string, ResolvedAccount>();
  const skippedAccounts: string[] = [];
  let accountsCreated = 0;

  for (const res of resolutions) {
    if (res.action === "skip") {
      skippedAccounts.push(res.csvName);
      continue;
    }
    if (res.action === "existing") {
      const account = await getAccount(client, res.accountId);
      accountMap.set(res.csvName, { accountId: account.id, paymentCategoryId: account.paymentCategoryId });
      continue;
    }

    let paymentCategoryId: string | null = null;
    if (res.type === "credit") {
      paymentCategoryId = await findOrCreateCreditPaymentCategory(client, planId, res.csvName);
    }
    const account = await createAccount(client, {
      planId,
      name: res.csvName,
      type: res.type,
      paymentCategoryId,
    });
    accountMap.set(res.csvName, { accountId: account.id, paymentCategoryId: account.paymentCategoryId });
    accountsCreated += 1;
  }

  return { accountMap, skippedAccounts, accountsCreated };
}

async function resolveCategories(
  client: SupabaseClient,
  planId: string,
  resolutions: CategoryResolution[],
): Promise<{ categoryMap: Map<string, string>; categoriesCreated: number; groupsCreated: number }> {
  const categoryMap = new Map<string, string>();
  const groupIdByName = new Map<string, string>();
  let categoriesCreated = 0;
  let groupsCreated = 0;

  for (const res of resolutions) {
    const key = `${res.categoryGroup}||${res.category}`;
    if (res.action === "existing") {
      categoryMap.set(key, res.categoryId);
      continue;
    }

    let groupId = res.existingGroupId ?? groupIdByName.get(res.categoryGroup);
    if (!groupId) {
      const { data: newGroup, error } = await client
        .from("category_groups")
        .insert({ name: res.categoryGroup, budget_mode: "category", plan_id: planId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      groupId = (newGroup as { id: string }).id;
      groupIdByName.set(res.categoryGroup, groupId);
      groupsCreated += 1;
    }

    const { data: cat, error: catErr } = await client
      .from("categories")
      .insert({ name: res.category, group_id: groupId })
      .select("id")
      .single();
    if (catErr) throw new Error(catErr.message);
    categoryMap.set(key, (cat as { id: string }).id);
    categoriesCreated += 1;
  }

  return { categoryMap, categoriesCreated, groupsCreated };
}

export async function runImport(client: SupabaseClient, input: ImportInput): Promise<ImportSummary> {
  const errors: string[] = [];

  const { accountMap, skippedAccounts, accountsCreated } = await resolveAccounts(
    client,
    input.planId,
    input.accountResolutions,
  );
  const { categoryMap, categoriesCreated, groupsCreated } = await resolveCategories(
    client,
    input.planId,
    input.categoryResolutions,
  );
  const readyToAssignId = await getReadyToAssignCategoryId(client);

  function resolveCategoryId(categoryGroup: string, category: string): string | null {
    if (isReadyToAssignCategory(categoryGroup, category)) return readyToAssignId;
    if (isCreditCardPaymentCategory(categoryGroup)) {
      return accountMap.get(category)?.paymentCategoryId ?? null;
    }
    return categoryMap.get(`${categoryGroup}||${category}`) ?? null;
  }

  let transactionsCreated = 0;
  let transactionsUpdated = 0;
  let transactionsMatchedToPlaid = 0;

  const claimablePools = await loadClaimablePlaidTransactions(client, [
    ...new Set([...accountMap.values()].map((a) => a.accountId)),
  ]);

  const preparedTransactions: { input: UpsertTransactionInput; label: string }[] = [];
  for (const t of input.register.transactions) {
    const account = accountMap.get(t.account);
    if (!account) continue; // account was skipped

    const label = `${t.account}/${t.date}/"${t.payee}"`;
    const allocations: TransactionAllocationInput[] = [];
    let failed = false;
    for (const a of t.allocations) {
      const categoryId = resolveCategoryId(a.categoryGroup, a.category);
      if (!categoryId) {
        errors.push(`Skipped transaction ${label}: could not resolve category "${a.categoryGroup}: ${a.category}"`);
        failed = true;
        break;
      }
      allocations.push({ categoryId, amountCents: a.amountCents });
    }
    if (failed) continue;

    // Migration overlap, reverse direction: this purchase may already exist
    // as a Plaid-imported row. If so, categorize that row instead of
    // inserting a duplicate — see loadClaimablePlaidTransactions.
    const claimPool = claimablePools.get(account.accountId);
    if (claimPool && claimPool.length > 0) {
      const matchIdx = selectAdoptionMatch({ amountCents: t.amountCents, txnDate: t.date }, claimPool);
      if (matchIdx >= 0) {
        const candidate = claimPool[matchIdx];
        claimPool.splice(matchIdx, 1);
        transactionsMatchedToPlaid += 1;
        try {
          await claimPlaidTransaction(client, candidate.id, allocations);
        } catch (e) {
          errors.push(
            `Failed to apply categorization for ${label} to existing Plaid transaction: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        continue;
      }
    }

    const now = new Date().toISOString();
    preparedTransactions.push({
      input: {
        accountId: account.accountId,
        amountCents: t.amountCents,
        txnDate: t.date,
        payee: t.payee,
        memo: t.memo || null,
        importedId: `csv:${hashTransaction(t)}`,
        clearedAt: t.cleared ? now : null,
        approvedAt: allocations.length > 0 ? now : null,
        allocations: allocations.length > 0 ? allocations : undefined,
      },
      label,
    });
  }

  await mapWithConcurrency(chunk(preparedTransactions, BATCH_SIZE), BATCH_CONCURRENCY, async (batch) => {
    try {
      const results = await bulkUpsertTransactions(
        client,
        batch.map((p) => p.input),
      );
      for (const r of results) {
        if (r.created) transactionsCreated += 1;
        else transactionsUpdated += 1;
      }
    } catch (e) {
      errors.push(describeBatchFailure("transactions", batch, e));
    }
  });

  let transfersCreated = 0;
  await mapWithConcurrency(input.register.transfers, CONCURRENCY, async (tr) => {
    const from = accountMap.get(tr.fromAccount);
    const to = accountMap.get(tr.toAccount);
    if (!from || !to) return; // one side was skipped

    try {
      const result = await createTransfer(client, {
        fromAccountId: from.accountId,
        toAccountId: to.accountId,
        amountCents: tr.amountCents,
        txnDate: tr.date,
        clearedAt: tr.cleared ? new Date().toISOString() : null,
        importedId: `csv:transfer:${hashTransfer(tr)}`,
      });
      if (result.created) transfersCreated += 1;
    } catch (e) {
      errors.push(
        `Transfer ${tr.fromAccount} -> ${tr.toAccount} on ${tr.date}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  let openingBalancesCreated = 0;
  const onBudgetOpeningBalances = input.register.openingBalances.filter(
    (ob) => ob.onBudget && ob.amountCents !== 0, // off-budget accounts skipped; a $0 balance is a no-op
  );
  await mapWithConcurrency(onBudgetOpeningBalances, CONCURRENCY, async (ob) => {
    const account = accountMap.get(ob.account);
    if (!account) return;

    try {
      await createOpeningBalance(client, {
        accountId: account.accountId,
        amountCents: ob.amountCents,
        txnDate: ob.date,
      });
      openingBalancesCreated += 1;
    } catch (e) {
      errors.push(`Opening balance for ${ob.account}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  let assignmentsWritten = 0;

  const preparedAssignments: { input: UpsertCategoryBudgetInput; label: string }[] = [];
  for (const a of input.plan.assignments) {
    const categoryId = a.isCreditCardPayment
      ? (accountMap.get(a.category)?.paymentCategoryId ?? null)
      : resolveCategoryId(a.categoryGroup, a.category);

    if (!categoryId) {
      errors.push(`Could not resolve assignment category "${a.categoryGroup}: ${a.category}" for ${a.month}`);
      continue;
    }

    preparedAssignments.push({
      input: { categoryId, month: a.month, assignedCents: a.assignedCents },
      label: `${a.categoryGroup}/${a.category}/${a.month}`,
    });
  }

  await mapWithConcurrency(chunk(preparedAssignments, BATCH_SIZE), BATCH_CONCURRENCY, async (batch) => {
    try {
      await bulkUpsertCategoryBudgets(
        client,
        batch.map((p) => p.input),
      );
      assignmentsWritten += batch.length;
    } catch (e) {
      errors.push(describeBatchFailure("assignments", batch, e));
    }
  });

  return {
    accountsCreated,
    groupsCreated,
    categoriesCreated,
    transactionsCreated,
    transactionsUpdated,
    transactionsMatchedToPlaid,
    transfersCreated,
    openingBalancesCreated,
    assignmentsWritten,
    skippedAccounts,
    errors,
  };
}
