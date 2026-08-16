import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAccount,
  createOpeningBalance,
  createTransfer,
  getAccount,
  getReadyToAssignCategoryId,
  upsertCategoryBudget,
  upsertTransaction,
} from "@/lib/ledger";
import type { AccountType, TransactionAllocationInput } from "@/lib/ledger/types";
import { mapWithConcurrency } from "./concurrency";
import { isCreditCardPaymentCategory, isReadyToAssignCategory } from "./mapping";
import type { ParsedTransaction, ParsedTransfer, PlanParseResult, RegisterParseResult } from "./types";

/**
 * How many ledger calls (transaction/transfer/opening-balance/assignment writes)
 * run concurrently. Each call is a handful of independent HTTP round trips to
 * PostgREST/RPC, so processing them one at a time is what made large imports slow.
 * 20 is a conservative default; bump it if your Supabase project's connection
 * pool comfortably handles more.
 */
const CONCURRENCY = 20;

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
  transfersCreated: number;
  openingBalancesCreated: number;
  assignmentsWritten: number;
  skippedAccounts: string[];
  errors: string[];
};

type ResolvedAccount = { accountId: string; paymentCategoryId: string | null };

function hashTransaction(t: ParsedTransaction): string {
  const payload = `${t.account}|${t.date}|${t.payee}|${t.amountCents}|${t.memo}|${t.rowIndex}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function hashTransfer(t: ParsedTransfer): string {
  const payload = `${t.fromAccount}|${t.toAccount}|${t.date}|${t.amountCents}|${t.rowIndex}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
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

  await mapWithConcurrency(input.register.transactions, CONCURRENCY, async (t) => {
    const account = accountMap.get(t.account);
    if (!account) return; // account was skipped

    const allocations: TransactionAllocationInput[] = [];
    let failed = false;
    for (const a of t.allocations) {
      const categoryId = resolveCategoryId(a.categoryGroup, a.category);
      if (!categoryId) {
        errors.push(
          `Skipped transaction ${t.account}/${t.date}/"${t.payee}": could not resolve category "${a.categoryGroup}: ${a.category}"`,
        );
        failed = true;
        break;
      }
      allocations.push({ categoryId, amountCents: a.amountCents });
    }
    if (failed) return;

    const now = new Date().toISOString();
    try {
      const result = await upsertTransaction(client, {
        accountId: account.accountId,
        amountCents: t.amountCents,
        txnDate: t.date,
        payee: t.payee,
        memo: t.memo || null,
        importedId: `csv:${hashTransaction(t)}`,
        clearedAt: t.cleared ? now : null,
        approvedAt: allocations.length > 0 ? now : null,
        allocations: allocations.length > 0 ? allocations : undefined,
      });
      if (result.created) transactionsCreated += 1;
      else transactionsUpdated += 1;
    } catch (e) {
      errors.push(`Transaction ${t.account}/${t.date}/"${t.payee}": ${e instanceof Error ? e.message : String(e)}`);
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
  await mapWithConcurrency(input.plan.assignments, CONCURRENCY, async (a) => {
    const categoryId = a.isCreditCardPayment
      ? (accountMap.get(a.category)?.paymentCategoryId ?? null)
      : resolveCategoryId(a.categoryGroup, a.category);

    if (!categoryId) {
      errors.push(`Could not resolve assignment category "${a.categoryGroup}: ${a.category}" for ${a.month}`);
      return;
    }

    try {
      await upsertCategoryBudget(client, { categoryId, month: a.month, assignedCents: a.assignedCents });
      assignmentsWritten += 1;
    } catch (e) {
      errors.push(
        `Assignment ${a.categoryGroup}/${a.category}/${a.month}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  return {
    accountsCreated,
    groupsCreated,
    categoriesCreated,
    transactionsCreated,
    transactionsUpdated,
    transfersCreated,
    openingBalancesCreated,
    assignmentsWritten,
    skippedAccounts,
    errors,
  };
}
