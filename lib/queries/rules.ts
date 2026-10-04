"use client";

import { defineQuery } from "./define-query";
import type { RulesResponse } from "@/app/api/rules/route";

async function fetchRules(): Promise<RulesResponse> {
  const res = await fetch("/api/rules");
  if (!res.ok) throw new Error("Failed to load rules");
  return res.json();
}

// Under the ledger root, so invalidateAllLedgerQueries after a rule change
// refreshes this list along with the transaction lists it affects.
const rulesQuery = defineQuery("category-rules", fetchRules);

export function useRules() {
  return rulesQuery.useResource([]);
}
