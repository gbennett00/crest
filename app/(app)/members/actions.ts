"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getActivePlanId } from "@/lib/plan/active-plan";
import {
  generateInvitationToken,
  isValidEmail,
  normalizeEmail,
} from "@/lib/plan/invitations";
import { buildInviteUrl } from "@/lib/plan/invite-url";

/**
 * Create an invitation to the active plan and return its shareable link. Owner-
 * only: the DB RLS policy on plan_invitations (WITH CHECK user_is_plan_owner) is
 * the real gate, so a non-owner's insert is rejected there and surfaced here.
 *
 * We don't send email — the inviter copies the returned link and sends it to the
 * person themselves (see the members page).
 */
export async function inviteMember(formData: FormData) {
  const rawEmail = (formData.get("email") as string) ?? "";
  const email = normalizeEmail(rawEmail);

  if (!email) return { error: "Email is required" };
  if (!isValidEmail(email)) return { error: "Enter a valid email address" };

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (user.email && normalizeEmail(user.email) === email) {
    return { error: "You're already a member of this plan" };
  }

  try {
    const planId = await getActivePlanId(supabase);

    // Already a member? (Owner can see the roster via plan_members RLS.)
    const { data: members } = await supabase.rpc("plan_members_with_email", {
      p_plan_id: planId,
    });
    const alreadyMember = (members ?? []).some(
      (m: { email: string }) => normalizeEmail(m.email) === email,
    );
    if (alreadyMember) {
      return { error: "That person is already a member of this plan" };
    }

    // Refresh any prior pending invite for this address (keeps the partial
    // unique index happy and resets the 7-day clock + token on re-invite).
    await supabase
      .from("plan_invitations")
      .delete()
      .eq("plan_id", planId)
      .eq("status", "pending")
      .eq("email", email);

    const token = generateInvitationToken();
    const { error: insertError } = await supabase.from("plan_invitations").insert({
      plan_id: planId,
      email,
      token,
      invited_by: user.id,
    });
    if (insertError) {
      // RLS denial (non-owner) lands here as well.
      return { error: insertError.message };
    }

    const inviteUrl = await buildInviteUrl(token);

    revalidatePath("/members");
    return { success: true, inviteUrl, email };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create invitation" };
  }
}

/** Revoke a pending invitation. Owner-only via RLS. */
export async function revokeInvitation(invitationId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("plan_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/members");
  return { success: true };
}

/** Remove a member from the active plan. Owner-only via RLS (never the owner). */
export async function removeMember(userId: string) {
  const supabase = await createClient();
  try {
    const planId = await getActivePlanId(supabase);
    const { error } = await supabase
      .from("plan_members")
      .delete()
      .eq("plan_id", planId)
      .eq("user_id", userId);
    if (error) return { error: error.message };

    revalidatePath("/members");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to remove member" };
  }
}

/**
 * Switch which plan the user is viewing. The `set_active_plan` RPC validates
 * membership and records the choice in the database, where RLS picks it up.
 */
export async function setActivePlan(planId: string) {
  const supabase = await createClient();
  try {
    const { error } = await supabase.rpc("set_active_plan", { p_plan_id: planId });
    if (error) {
      return {
        error: error.message.includes("not_a_member")
          ? "You're not a member of that plan"
          : error.message,
      };
    }

    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to switch plan" };
  }
}
