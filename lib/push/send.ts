import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

function configureWebPush(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT must be set",
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

/**
 * Sends a push notification to every subscription belonging to any of
 * `userIds`. A subscription the push service reports as gone (410, or 404 —
 * permission revoked, browser data cleared) is deleted so it stops being
 * retried on every future send.
 */
export async function sendPushToUsers(
  client: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;
  configureWebPush();

  const { data, error } = await client
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .in("user_id", userIds);
  if (error) throw new Error(error.message);

  const subscriptions = (data ?? []) as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth_key: string;
  }>;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await client.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("Push send failed for subscription", sub.id, err);
        }
      }
    }),
  );
}

/** Notifies every member of `planId` — used for events tied to a plan (a
 * bank sync, a connection error) rather than to a single user's action. */
export async function sendPushToPlan(
  client: SupabaseClient,
  planId: string,
  payload: PushPayload,
): Promise<void> {
  const { data, error } = await client
    .from("plan_members")
    .select("user_id")
    .eq("plan_id", planId);
  if (error) throw new Error(error.message);

  const userIds = (data ?? []).map((row) => row.user_id as string);
  await sendPushToUsers(client, userIds, payload);
}
