import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountBase, Transaction, RemovedTransaction } from "plaid";

import {
  upsertTransaction,
  updateTransaction,
  deleteTransaction,
  syncBankClearedBalance,
  createAccount,
  RECONCILIATION_ADJUSTMENT_PAYEE,
} from "@/lib/ledger";
import type { AccountType } from "@/lib/ledger/types";
import { createPlaidClient } from "./client";
import {
  plaidAccountTypeToCrest,
  plaidBalanceToBalanceCents,
  plaidTxnToUpsertInput,
} from "./mapping";
import { selectAdoptionMatch, type AdoptionCandidate } from "./match";

type PlaidItemRow = {
  id: string;
  plan_id: string;
  plaid_item_id: string;
  access_token: string;
  transactions_cursor: string | null;
  /** Plaid account ids the user opted out of tracking; never created or synced. */
  ignored_account_ids: string[] | null;
};

type SyncResult = {
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  accountsCreated: number;
  /** YNAB-imported rows adopted by a matching Plaid txn instead of duplicated. */
  adoptedCount: number;
};

/**
 * Crest accounts in this plan not yet attached to any Plaid account — candidates
 * for the user to link an incoming Plaid Item's accounts onto, instead of always
 * creating a new (duplicate) account per bank account.
 */
export async function getUnlinkedAccounts(
  client: SupabaseClient,
  planId: string,
): Promise<{ id: string; name: string; type: AccountType }[]> {
  const { data, error } = await client
    .from("accounts")
    .select("id, name, type")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .is("plaid_account_id", null);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    type: row.type as AccountType,
  }));
}

/** Metadata for the accounts on a just-exchanged Plaid Item, before any sync has run. */
export async function getPlaidAccountsForItem(accessToken: string): Promise<AccountBase[]> {
  const plaid = createPlaidClient();
  const response = await plaid.accountsGet({ access_token: accessToken });
  return response.data.accounts;
}

/**
 * Attaches an existing Crest account to a Plaid account instead of letting
 * ensureAccountExists create a new one. Call before syncItem — resolveAccountMap
 * will then find this account already linked and syncItem will extend its
 * history forward rather than starting a disconnected duplicate.
 */
export async function attachExistingAccountToPlaid(
  client: SupabaseClient,
  accountId: string,
  plaidItemId: string,
  plaidAccountId: string,
): Promise<void> {
  const { error } = await client
    .from("accounts")
    .update({
      plaid_item_id: plaidItemId,
      plaid_account_id: plaidAccountId,
      is_linked: true,
    })
    .eq("id", accountId);

  if (error) throw new Error(error.message);
}

/**
 * Loads the pool of existing transactions in the given accounts that a Plaid
 * txn may be adopted onto instead of duplicated (see match.ts). Eligible rows
 * are ones the user entered or imported that aren't yet tied to Plaid:
 *
 *   - manual entries (`imported_id IS NULL`), and
 *   - YNAB CSV imports (`imported_id LIKE 'csv:%'`).
 *
 * Everything else is deliberately excluded:
 *   - already Plaid-backed rows carry a Plaid `transaction_id` (neither null nor
 *     `csv:`), so the query's filter skips them and re-syncs dedupe normally;
 *   - transfers (`transfer_account_id` set, incl. `csv:transfer:` legs) — adopting
 *     one leg would muddy the transfer's two-sided linkage;
 *   - opening balances (`crest:opening_balance`) — excluded by the id filter;
 *   - reconciliation adjustments (null id, but a distinctive payee) — excluded here.
 */
async function loadAdoptionCandidates(
  client: SupabaseClient,
  accountIds: string[],
): Promise<Map<string, AdoptionCandidate[]>> {
  const pools = new Map<string, AdoptionCandidate[]>();
  if (accountIds.length === 0) return pools;

  const { data, error } = await client
    .from("transactions")
    .select("id, account_id, amount_cents, txn_date, imported_id, payee, transfer_account_id")
    .in("account_id", accountIds)
    .is("transfer_account_id", null)
    .or("imported_id.is.null,imported_id.like.csv:*");

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const importedId = row.imported_id as string | null;
    // Belt-and-suspenders: transfer legs are already excluded by the null
    // transfer_account_id filter, but guard the csv:transfer: prefix too.
    if (importedId?.startsWith("csv:transfer:")) continue;
    // A reconciliation adjustment is a synthetic null-id line — never adopt it.
    if ((row.payee as string | null) === RECONCILIATION_ADJUSTMENT_PAYEE) continue;

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

/**
 * Adopts an existing YNAB-imported row onto an incoming Plaid transaction:
 * rewrites its `imported_id` to Plaid's so subsequent syncs dedupe normally,
 * and marks it cleared when Plaid reports it posted. The row's amount, date,
 * payee, memo, allocations, and approval are deliberately left untouched so the
 * user's categorization survives the migration.
 */
async function adoptTransaction(
  client: SupabaseClient,
  id: string,
  plaidImportedId: string,
  clearedAt: string | null,
): Promise<void> {
  const update: Record<string, unknown> = { imported_id: plaidImportedId };
  // Only ever move a row toward "cleared"; never un-clear one Plaid reports pending.
  if (clearedAt) update.cleared_at = clearedAt;

  const { error } = await client.from("transactions").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

async function resolveAccountMap(
  client: SupabaseClient,
  plaidItemId: string,
): Promise<Map<string, string>> {
  const { data, error } = await client
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("plaid_item_id", plaidItemId)
    .not("plaid_account_id", "is", null);

  if (error) throw new Error(error.message);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.plaid_account_id as string, row.id as string);
  }
  return map;
}

async function ensureAccountExists(
  client: SupabaseClient,
  plaidAccount: AccountBase,
  plaidItemId: string,
  planId: string,
  accountMap: Map<string, string>,
): Promise<string> {
  const existing = accountMap.get(plaidAccount.account_id);
  if (existing) return existing;

  const type: AccountType = plaidAccountTypeToCrest(
    plaidAccount.type,
    plaidAccount.subtype,
  );

  let paymentCategoryId: string | null = null;
  if (type === "credit") {
    const { data: existing } = await client
      .from("category_groups")
      .select("id")
      .eq("name", "Credit Cards")
      .maybeSingle();

    let groupId: string;
    if (existing) {
      groupId = existing.id as string;
    } else {
      const { data: newGroup, error: gErr } = await client
        .from("category_groups")
        .insert({
          name: "Credit Cards",
          budget_mode: "category",
          plan_id: planId,
        })
        .select("id")
        .single();
      if (gErr) throw new Error(gErr.message);
      groupId = (newGroup as { id: string }).id;
    }

    const catName = `${plaidAccount.name ?? "Card"} Payment`;
    const { data: cat, error: cErr } = await client
      .from("categories")
      .insert({ name: catName, group_id: groupId })
      .select("id")
      .single();
    if (cErr) throw new Error(cErr.message);
    paymentCategoryId = (cat as { id: string }).id;
  }

  const account = await createAccount(client, {
    planId,
    name: plaidAccount.name ?? plaidAccount.official_name ?? "Linked Account",
    type,
    paymentCategoryId,
    isLinked: true,
  });

  await client
    .from("accounts")
    .update({
      plaid_item_id: plaidItemId,
      plaid_account_id: plaidAccount.account_id,
    })
    .eq("id", account.id);

  accountMap.set(plaidAccount.account_id, account.id);
  return account.id;
}

export async function syncItem(
  client: SupabaseClient,
  item: PlaidItemRow,
): Promise<SyncResult> {
  const plaid = createPlaidClient();
  let cursor = item.transactions_cursor ?? undefined;
  let hasMore = true;

  const allAdded: Transaction[] = [];
  const allModified: Transaction[] = [];
  const allRemoved: RemovedTransaction[] = [];
  let syncAccounts: AccountBase[] = [];

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: item.access_token,
      cursor,
      count: 500,
    });
    const data = response.data;

    allAdded.push(...data.added);
    allModified.push(...data.modified);
    allRemoved.push(...data.removed);
    if (data.accounts.length > 0) {
      syncAccounts = data.accounts;
    }

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  const accountMap = await resolveAccountMap(client, item.plaid_item_id);
  let accountsCreated = 0;

  // Plaid accounts the user opted out of tracking: skip creation entirely, which
  // also drops their transactions (the txn loop below ignores accounts absent
  // from accountMap) and their balance sync.
  const ignoredAccounts = new Set(item.ignored_account_ids ?? []);

  for (const plaidAccount of syncAccounts) {
    if (ignoredAccounts.has(plaidAccount.account_id)) continue;
    const before = accountMap.size;
    await ensureAccountExists(
      client,
      plaidAccount,
      item.plaid_item_id,
      item.plan_id,
      accountMap,
    );
    if (accountMap.size > before) accountsCreated++;
  }

  // Pool of YNAB-imported rows (per account) that an incoming Plaid txn can be
  // adopted onto instead of inserting a duplicate across the migration overlap.
  // Loaded once and consumed as matches are made, so one YNAB row is adopted at
  // most once per sync.
  const adoptionPools = await loadAdoptionCandidates(client, [
    ...new Set(accountMap.values()),
  ]);
  let adoptedCount = 0;

  for (const txn of [...allAdded, ...allModified]) {
    const crestAccountId = accountMap.get(txn.account_id);
    if (!crestAccountId) continue;

    const input = plaidTxnToUpsertInput(txn, crestAccountId);
    if (input.amountCents === 0) continue;

    if (txn.pending_transaction_id) {
      const { data: pendingRow } = await client
        .from("transactions")
        .select("id, amount_cents, approved_at")
        .eq("account_id", crestAccountId)
        .eq("imported_id", txn.pending_transaction_id)
        .maybeSingle();

      if (pendingRow) {
        const amountChanged =
          (pendingRow.amount_cents as number) !== input.amountCents;

        await updateTransaction(client, {
          id: pendingRow.id as string,
          amountCents: input.amountCents,
          txnDate: input.txnDate,
          payee: input.payee,
          memo: input.memo ?? null,
          clearedAt: input.clearedAt ?? null,
          // Only strip approval if the amount changed — existing
          // allocations won't sum correctly with a different total.
          ...(amountChanged
            ? { approvedAt: null, allocations: [] }
            : {}),
        });

        // Swap imported_id from the pending transaction_id to the
        // posted one so future syncs deduplicate correctly.
        await client
          .from("transactions")
          .update({ imported_id: input.importedId })
          .eq("id", pendingRow.id as string);

        continue;
      }
    }

    // Migration overlap: adopt a matching YNAB-imported row rather than inserting
    // a duplicate. Only runs for accounts that carry csv: rows (i.e. ones a YNAB
    // import populated before Plaid was linked).
    const pool = adoptionPools.get(crestAccountId);
    if (pool && pool.length > 0) {
      const matchIdx = selectAdoptionMatch(
        { amountCents: input.amountCents, txnDate: input.txnDate },
        pool,
      );
      if (matchIdx >= 0) {
        await adoptTransaction(
          client,
          pool[matchIdx].id,
          input.importedId,
          input.clearedAt ?? null,
        );
        pool.splice(matchIdx, 1);
        adoptedCount++;
        continue;
      }
    }

    await upsertTransaction(client, input);
  }

  for (const removed of allRemoved) {
    if (!removed.transaction_id) continue;
    const { data: row } = await client
      .from("transactions")
      .select("id")
      .eq("imported_id", removed.transaction_id)
      .maybeSingle();
    if (row) {
      await deleteTransaction(client, row.id as string);
    }
  }

  for (const plaidAccount of syncAccounts) {
    const crestAccountId = accountMap.get(plaidAccount.account_id);
    if (!crestAccountId) continue;
    const balanceCents = plaidBalanceToBalanceCents(plaidAccount);
    await syncBankClearedBalance(client, crestAccountId, balanceCents);
  }

  await client
    .from("plaid_items")
    .update({
      transactions_cursor: cursor,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  return {
    addedCount: allAdded.length,
    modifiedCount: allModified.length,
    removedCount: allRemoved.length,
    accountsCreated,
    adoptedCount,
  };
}
