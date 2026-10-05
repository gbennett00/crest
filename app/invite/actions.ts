"use server";

import { createClient } from "@/lib/supabase/server";

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  invitation_not_found: "This invitation link is not valid.",
  invitation_not_pending: "This invitation has already been used or revoked.",
  invitation_expired: "This invitation has expired.",
  invitation_email_mismatch:
    "This invitation was sent to a different email address than the one you're signed in with.",
  not_authenticated: "Please sign in to accept this invitation.",
};

/**
 * Accept a plan invitation. Runs the SECURITY DEFINER `accept_plan_invitation`
 * RPC, which validates the token, expiry and that the signed-in email matches, and
 * makes the newly joined plan the user's active one so they land on the shared budget.
 */
export async function acceptInvitation(token: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: ACCEPT_ERROR_MESSAGES.not_authenticated };

  const { error } = await supabase.rpc("accept_plan_invitation", {
    p_token: token,
  });

  if (error) {
    const key = Object.keys(ACCEPT_ERROR_MESSAGES).find((k) =>
      error.message.includes(k),
    );
    return { error: key ? ACCEPT_ERROR_MESSAGES[key] : error.message };
  }

  return { success: true };
}
