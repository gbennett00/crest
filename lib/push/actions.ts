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

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userData.user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
    },
    { onConflict: "endpoint" },
  );
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
