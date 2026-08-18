"use server";

import { createClient } from "@/lib/supabase/server";
import { getActivePlanId } from "@/lib/plan/active-plan";
import type { AccountType } from "@/lib/ledger/types";
import { parseRegisterCsv } from "@/lib/ynab-import/parse-register";
import { parsePlanCsv } from "@/lib/ynab-import/parse-plan";
import {
  buildAccountMappingCandidates,
  buildCategoryMappingCandidates,
  type AccountMappingCandidate,
  type CategoryMappingCandidate,
} from "@/lib/ynab-import/mapping";
import {
  runImport,
  type AccountResolution,
  type CategoryResolution,
  type ImportSummary,
} from "@/lib/ynab-import/run";

export type ImportPreview = {
  accountCandidates: AccountMappingCandidate[];
  categoryCandidates: CategoryMappingCandidate[];
  existingAccounts: { id: string; name: string; type: AccountType }[];
  counts: {
    transactions: number;
    transfers: number;
    openingBalances: number;
    assignments: number;
    futureRowsSkipped: number;
  };
  warnings: string[];
};

export async function previewImport(
  registerText: string,
  planText: string,
): Promise<{ preview: ImportPreview } | { error: string }> {
  try {
    const register = parseRegisterCsv(registerText);
    const plan = parsePlanCsv(planText);

    const supabase = await createClient();

    const [accountsRes, groupsRes, categoriesRes] = await Promise.all([
      supabase.from("accounts").select("id, name, type").eq("is_active", true),
      supabase.from("category_groups").select("id, name"),
      supabase.from("categories").select("id, name, group_id").is("role", null),
    ]);

    if (accountsRes.error) return { error: accountsRes.error.message };
    if (groupsRes.error) return { error: groupsRes.error.message };
    if (categoriesRes.error) return { error: categoriesRes.error.message };

    const existingAccounts = (accountsRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as AccountType,
    }));
    const existingGroups = (groupsRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
    }));
    const existingCategories = (categoriesRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      groupId: r.group_id as string,
    }));

    const accountCandidates = buildAccountMappingCandidates(register, existingAccounts);
    const categoryCandidates = buildCategoryMappingCandidates(
      register,
      plan,
      existingGroups,
      existingCategories,
    );

    return {
      preview: {
        accountCandidates,
        categoryCandidates,
        existingAccounts,
        counts: {
          transactions: register.transactions.length,
          transfers: register.transfers.length,
          openingBalances: register.openingBalances.filter((b) => b.onBudget).length,
          assignments: plan.assignments.length,
          futureRowsSkipped: register.futureRowsSkipped,
        },
        warnings: register.warnings,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to parse CSV files" };
  }
}

export async function confirmImport(
  registerText: string,
  planText: string,
  accountResolutions: AccountResolution[],
  categoryResolutions: CategoryResolution[],
): Promise<{ summary: ImportSummary } | { error: string }> {
  try {
    const register = parseRegisterCsv(registerText);
    const plan = parsePlanCsv(planText);
    const supabase = await createClient();
    const planId = await getActivePlanId(supabase);

    const summary = await runImport(supabase, {
      register,
      plan,
      planId,
      accountResolutions,
      categoryResolutions,
    });

    return { summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Import failed" };
  }
}
