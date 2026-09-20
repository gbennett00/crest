"use server";

import { createClient } from "@/lib/supabase/server";
import { sendPushToUsers } from "./send";

export async function subscribeToPush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "Not signed in" };

  // A plain upsert on `endpoint` would hit RLS on the update path whenever
  // this browser's endpoint was last claimed by a different account (shared
  // device, or testing multiple accounts in one browser) — see the
  // upsert_push_subscription migration for why this needs to go through a
  // SECURITY DEFINER function instead.
  const { error } = await supabase.rpc("upsert_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth_key: subscription.keys.auth,
  });
  if (error) return { error: error.message };
  return {};
}

export async function unsubscribeFromPush(
  endpoint: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return {};
}

export async function sendTestPush(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "Not signed in" };

  await sendPushToUsers(supabase, [userData.user.id], {
    title: "Test notification",
    body: "If you can see this, push is working.",
    url: "/",
  });
  return {};
}
