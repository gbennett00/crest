"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getActivePlanId, ACTIVE_PLAN_COOKIE } from "@/lib/plan/active-plan";
import {
  generateInvitationToken,
  isValidEmail,
  listUserPlans,
  normalizeEmail,
} from "@/lib/plan/invitations";
import { sendInvitationEmail } from "@/lib/email/invitation";

/**
 * Invite someone to the active plan by email. Owner-only: the DB RLS policy on
 * plan_invitations (WITH CHECK user_is_plan_owner) is the real gate, so a
 * non-owner's insert is rejected there and surfaced as an error here.
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
    const { data: planRow } = await supabase
      .from("plans")
      .select("name")
      .eq("id", planId)
      .maybeSingle();

    const delivery = await sendInvitationEmail({
      to: email,
      inviterEmail: user.email ?? "A Crest user",
      planName: (planRow?.name as string) ?? "a budget",
      inviteUrl,
    });

    revalidatePath("/members");
    return { success: true, inviteUrl, delivered: delivery.delivered };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send invitation" };
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

/** Switch which plan the user is viewing. Validates membership before setting. */
export async function setActivePlan(planId: string) {
  const supabase = await createClient();
  try {
    const plans = await listUserPlans(supabase);
    if (!plans.some((p) => p.planId === planId)) {
      return { error: "You're not a member of that plan" };
    }

    const store = await cookies();
    store.set(ACTIVE_PLAN_COOKIE, planId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to switch plan" };
  }
}

async function buildInviteUrl(token: string): Promise<string> {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envBase) return `${envBase}/invite/${token}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/invite/${token}`;
}
