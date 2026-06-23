import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountBase, Transaction, RemovedTransaction } from "plaid";

import {
  upsertTransaction,
  deleteTransaction,
  syncBankClearedBalance,
  createAccount,
} from "@/lib/ledger";
import type { AccountType } from "@/lib/ledger/types";
import { createPlaidClient } from "./client";
import {
  plaidAccountTypeToCrest,
  plaidBalanceToBalanceCents,
  plaidTxnToUpsertInput,
} from "./mapping";

type PlaidItemRow = {
  id: string;
  plan_id: string;
  plaid_item_id: string;
  access_token: string;
  transactions_cursor: string | null;
};

type SyncResult = {
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  accountsCreated: number;
};

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

  for (const plaidAccount of syncAccounts) {
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

  for (const txn of [...allAdded, ...allModified]) {
    const crestAccountId = accountMap.get(txn.account_id);
    if (!crestAccountId) continue;

    if (txn.pending_transaction_id) {
      const { data: pendingRow } = await client
        .from("transactions")
        .select("id")
        .eq("account_id", crestAccountId)
        .eq("imported_id", txn.pending_transaction_id)
        .maybeSingle();
      if (pendingRow) {
        await deleteTransaction(client, pendingRow.id as string);
      }
    }

    const input = plaidTxnToUpsertInput(txn, crestAccountId);
    if (input.amountCents === 0) continue;
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
  };
}
