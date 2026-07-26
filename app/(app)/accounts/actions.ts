"use server";

import { revalidatePath } from "next/cache";
import { CountryCode, Products } from "plaid";
import { createClient } from "@/lib/supabase/server";
import {
  createAccount,
  LedgerError,
  reconcileWithAdjustment,
  reconcileWithRegisterBalance,
} from "@/lib/ledger";
import { getActivePlanId } from "@/lib/plan/active-plan";
import { createPlaidClient } from "@/lib/plaid/client";
import { syncItem } from "@/lib/plaid/sync";

export async function createManualAccount(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const type = formData.get("type") as "checking" | "savings" | "credit";
  const rawBalance = formData.get("openingBalance") as string;
  const paymentCategoryName =
    (formData.get("paymentCategoryName") as string)?.trim() ||
    `${name} Payment`;

  if (!name) return { error: "Account name is required" };
  if (!["checking", "savings", "credit"].includes(type))
    return { error: "Invalid account type" };

  const rawCents = rawBalance ? Math.round(parseFloat(rawBalance) * 100) : 0;
  if (isNaN(rawCents)) return { error: "Invalid opening balance" };
  // Credit card "balance owed" is entered as a positive number by the user but
  // represents debt — store and record it as a negative (outflow from the account).
  const openingBalanceCents = type === "credit" ? -rawCents : rawCents;

  const supabase = await createClient();

  try {
    const planId = await getActivePlanId(supabase);
    let paymentCategoryId: string | null = null;

    if (type === "credit") {
      // Find or create the Credit Cards group (RLS scopes this to the plan).
      const { data: existing } = await supabase
        .from("category_groups")
        .select("id")
        .eq("name", "Credit Cards")
        .maybeSingle();

      let groupId: string;
      if (existing) {
        groupId = existing.id as string;
      } else {
        const { data: newGroup, error: gErr } = await supabase
          .from("category_groups")
          .insert({ name: "Credit Cards", budget_mode: "category", plan_id: planId })
          .select("id")
          .single();
        if (gErr) return { error: gErr.message };
        groupId = (newGroup as { id: string }).id;
      }

      const { data: cat, error: cErr } = await supabase
        .from("categories")
        .insert({ name: paymentCategoryName, group_id: groupId })
        .select("id")
        .single();
      if (cErr) return { error: cErr.message };
      paymentCategoryId = (cat as { id: string }).id;
    }

    await createAccount(supabase, {
      planId,
      name,
      type,
      openingBalanceCents,
      paymentCategoryId,
    });

    revalidatePath("/accounts");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to create account" };
  }
}

/**
 * "The calculated cleared balance looks right" path: set balance_cents to the
 * register cleared balance and mark cleared lines reconciled.
 */
export async function reconcileMatched(accountId: string) {
  const supabase = await createClient();
  try {
    const result = await reconcileWithRegisterBalance(supabase, accountId);
    revalidatePath("/accounts");
    return { success: true, reconciledAt: result.reconciledAt };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Reconciliation failed" };
  }
}

/**
 * "The calculated balance is off" path: write a balance adjustment for the
 * difference (assigned to Ready to Assign), then reconcile to `actualCents`.
 */
export async function reconcileWithAdjustmentAction(
  accountId: string,
  actualCents: number,
) {
  const supabase = await createClient();
  try {
    const result = await reconcileWithAdjustment(supabase, accountId, actualCents);
    revalidatePath("/accounts");
    return { success: true, reconciledAt: result.reconciledAt };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Reconciliation failed" };
  }
}

// ---------------------------------------------------------------------------
// Plaid integration
// ---------------------------------------------------------------------------

export async function createLinkToken() {
  const supabase = await createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const plaid = createPlaidClient();
    const response = await plaid.linkTokenCreate({
      client_name: "Crest",
      language: "en",
      country_codes: [CountryCode.Us],
      user: { client_user_id: user.id },
      products: [Products.Transactions],
      transactions: { days_requested: 90 },
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    });

    return { linkToken: response.data.link_token };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create link token";
    return { error: message };
  }
}

export async function exchangePublicToken(publicToken: string) {
  const supabase = await createClient();
  try {
    const planId = await getActivePlanId(supabase);
    const plaid = createPlaidClient();

    const exchangeResponse = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const { access_token, item_id } = exchangeResponse.data;

    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const itemResponse = await plaid.itemGet({ access_token });
      institutionId = itemResponse.data.item.institution_id ?? null;
      if (institutionId) {
        const instResponse = await plaid.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = instResponse.data.institution.name;
      }
    } catch {
      // Non-critical — institution name is cosmetic
    }

    const { error: insertError } = await supabase.from("plaid_items").insert({
      plan_id: planId,
      plaid_item_id: item_id,
      access_token,
      institution_id: institutionId,
      institution_name: institutionName,
      status: "good",
    });
    if (insertError) return { error: insertError.message };

    const { data: itemRow } = await supabase
      .from("plaid_items")
      .select("*")
      .eq("plaid_item_id", item_id)
      .single();

    if (itemRow) {
      await syncItem(supabase, itemRow as never);
    }

    revalidatePath("/accounts");
    return { success: true, itemId: item_id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to exchange token";
    return { error: message };
  }
}

export async function syncLinkedItem(plaidItemId: string) {
  const supabase = await createClient();
  try {
    const { data: itemRow, error } = await supabase
      .from("plaid_items")
      .select("*")
      .eq("plaid_item_id", plaidItemId)
      .single();

    if (error || !itemRow) return { error: "Item not found" };

    const result = await syncItem(supabase, itemRow as never);
    revalidatePath("/accounts");
    return { success: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return { error: message };
  }
}

export async function unlinkItem(plaidItemId: string) {
  const supabase = await createClient();
  try {
    const { data: itemRow, error } = await supabase
      .from("plaid_items")
      .select("access_token")
      .eq("plaid_item_id", plaidItemId)
      .single();

    if (error || !itemRow) return { error: "Item not found" };

    const plaid = createPlaidClient();
    await plaid.itemRemove({
      access_token: (itemRow as { access_token: string }).access_token,
    });

    await supabase
      .from("accounts")
      .update({ is_linked: false, plaid_item_id: null, plaid_account_id: null })
      .eq("plaid_item_id", plaidItemId);

    await supabase
      .from("plaid_items")
      .delete()
      .eq("plaid_item_id", plaidItemId);

    revalidatePath("/accounts");
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to unlink";
    return { error: message };
  }
}
