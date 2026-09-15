"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { AccountListRow } from "@/app/api/accounts/route";
import type { AccountRegisterResponse } from "@/app/api/accounts/[id]/register/route";

// ---------------------------------------------------------------------------
// Accounts list
// ---------------------------------------------------------------------------

async function fetchAccountsList(): Promise<{ accounts: AccountListRow[] }> {
  const res = await fetch("/api/accounts");
  if (!res.ok) throw new Error("Failed to load accounts");
  return res.json();
}

const accountsListQuery = defineQuery("accounts-list", fetchAccountsList);

export function useAccountsList() {
  return accountsListQuery.useResource([]);
}

export function prefetchAccountsList(queryClient: QueryClient) {
  return accountsListQuery.prefetch(queryClient);
}

// ---------------------------------------------------------------------------
// Account register
// ---------------------------------------------------------------------------

async function fetchAccountRegister(
  accountId: string,
  categoryFilter: string | undefined,
  monthFilter: string | undefined,
): Promise<AccountRegisterResponse> {
  const params = new URLSearchParams();
  if (categoryFilter) params.set("category", categoryFilter);
  if (monthFilter) params.set("month", monthFilter);
  const qs = params.toString();
  const res = await fetch(`/api/accounts/${accountId}/register${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to load account register");
  return res.json();
}

const accountRegisterQuery = defineQuery("account-register", fetchAccountRegister);

export function useAccountRegister(
  accountId: string,
  categoryFilter: string | undefined,
  monthFilter: string | undefined,
) {
  return accountRegisterQuery.useResource([accountId, categoryFilter, monthFilter]);
}

/** Warms the cache for an account's register before the user clicks into it. */
export function prefetchAccountRegister(queryClient: QueryClient, accountId: string) {
  return accountRegisterQuery.prefetch(queryClient, accountId, undefined, undefined);
}
