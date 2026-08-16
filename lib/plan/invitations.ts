import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { LedgerError } from "@/lib/ledger";

/**
 * Invitations to collaborate on a plan.
 *
 * Authorization is enforced at the DB level (see 20260816120000_plan_invitations):
 * only a plan's owner can create/see/revoke its invitations, and the accept flow
 * runs through the SECURITY DEFINER `accept_plan_invitation` RPC. This module is
 * the typed app-side surface over those tables and functions, plus the pure
 * helpers (token generation, expiry, email validation) that are unit tested.
 */

/** Invitations expire this many days after they are created. */
export const INVITATION_TTL_DAYS = 7;

export type MemberRole = "owner" | "member";
export type InvitationStatus = "pending" | "accepted" | "revoked";

export interface PlanMember {
  userId: string;
  email: string;
  role: MemberRole;
  createdAt: string;
}

export interface PlanInvitation {
  id: string;
  email: string;
  token: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  /** Derived: expired invitations keep status 'pending' until re-invited. */
  expired: boolean;
}

export interface InvitationDetails {
  planName: string;
  inviterEmail: string;
  inviteeEmail: string;
  status: InvitationStatus;
  expired: boolean;
}

export interface UserPlan {
  planId: string;
  name: string;
  role: MemberRole;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Opaque, URL-safe token used in the invite link. */
export function generateInvitationToken(): string {
  return randomBytes(24).toString("base64url");
}

/** An invitation is expired once its expiry instant has passed. */
export function isInvitationExpired(
  expiresAt: string | Date,
  now: Date = new Date(),
): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deliberately permissive shape check — real delivery is the source of truth. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/** Members of a plan (email resolved via the `plan_members_with_email` RPC). */
export async function listPlanMembers(
  client: SupabaseClient,
  planId: string,
): Promise<PlanMember[]> {
  const { data, error } = await client.rpc("plan_members_with_email", {
    p_plan_id: planId,
  });
  if (error) throw new LedgerError("db_error", error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    userId: row.user_id as string,
    email: row.email as string,
    role: row.role as MemberRole,
    createdAt: row.created_at as string,
  }));
}

/** Pending invitations for a plan (owner-only via RLS), newest first. */
export async function listPendingInvitations(
  client: SupabaseClient,
  planId: string,
): Promise<PlanInvitation[]> {
  const { data, error } = await client
    .from("plan_invitations")
    .select("id, email, token, status, created_at, expires_at")
    .eq("plan_id", planId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new LedgerError("db_error", error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    token: row.token as string,
    status: row.status as InvitationStatus,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    expired: isInvitationExpired(row.expires_at as string),
  }));
}

/** Plans the current user belongs to (via the `my_plans` RPC). */
export async function listUserPlans(client: SupabaseClient): Promise<UserPlan[]> {
  const { data, error } = await client.rpc("my_plans");
  if (error) throw new LedgerError("db_error", error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    planId: row.plan_id as string,
    name: row.name as string,
    role: row.role as MemberRole,
    createdAt: row.created_at as string,
  }));
}

/**
 * Intro details for an invitation, resolvable by anyone holding the token
 * (including logged-out visitors) via the `get_invitation_details` RPC.
 */
export async function getInvitationDetails(
  client: SupabaseClient,
  token: string,
): Promise<InvitationDetails | null> {
  const { data, error } = await client.rpc("get_invitation_details", {
    p_token: token,
  });
  if (error) throw new LedgerError("db_error", error.message);

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    planName: row.plan_name as string,
    inviterEmail: row.inviter_email as string,
    inviteeEmail: row.invitee_email as string,
    status: row.status as InvitationStatus,
    expired: row.expired as boolean,
  };
}
