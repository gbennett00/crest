/**
 * Keeps plaid_items' connection-health columns in step with Plaid, and reads
 * them back as a per-Item health summary for the UI.
 *
 * Every write goes through applyItemPatch, which compares health before and
 * after and sends the "needs repair" push only on the transition into that
 * state. That is what keeps webhooks, syncs and the daily cron from paging the
 * user twice for the same problem, or not at all.
 *
 * The pure pieces (patch builders) are exported for tests; the rest talk to
 * Plaid and Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemGetResponse } from "plaid";

import { sendPushToPlan } from "@/lib/push";
import { createPlaidClient } from "./client";
import {
  deriveConnectionHealth,
  EXPIRING_WITHIN_MS,
  isRevokedErrorCode,
  type ConnectionHealthInput,
  type ItemConnection,
  type PlaidItemStatus,
} from "./connection-health";
import { syncItem } from "./sync";

export type { ItemConnection };

export type ItemStatusPatch = {
  status?: PlaidItemStatus;
  error_code?: string | null;
  last_successful_update?: string | null;
  last_failed_update?: string | null;
  consent_expiration_time?: string | null;
  disconnect_warned_at?: string | null;
  status_checked_at?: string;
};

type PlaidErrorBody = { error_type?: unknown; error_code?: unknown };

function plaidErrorBody(err: unknown): PlaidErrorBody | null {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  return data && typeof data === "object" ? (data as PlaidErrorBody) : null;
}

/** The Plaid error code on a failed Plaid API call (axios error), if any. */
export function plaidErrorCode(err: unknown): string | null {
  const code = plaidErrorBody(err)?.error_code;
  return typeof code === "string" ? code : null;
}

/**
 * The error code of a failed call *if it describes the Item* — worth storing as
 * the Item's error. Plaid also fails calls for reasons that say nothing about
 * the connection (our bad request, an API outage, our own rate limit); storing
 * those would tell the user to repair a connection that isn't broken.
 */
export function itemErrorCode(err: unknown): string | null {
  const body = plaidErrorBody(err);
  const code = plaidErrorCode(err);
  if (!body || !code) return null;
  if (body.error_type === "ITEM_ERROR" || body.error_type === "INSTITUTION_ERROR") return code;
  // INVALID_ACCESS_TOKEN is an INVALID_INPUT error, but it does mean the Item is gone.
  return isRevokedErrorCode(code) ? code : null;
}

/** Patch for a successful /item/get. */
export function statusPatchFromItemGet(
  response: Pick<ItemGetResponse, "item" | "status">,
  now: Date = new Date(),
): ItemStatusPatch {
  const errorCode = response.item.error?.error_code ?? null;
  const tx = response.status?.transactions;
  const consent = response.item.consent_expiration_time ?? null;

  const patch: ItemStatusPatch = {
    // No error means the Item works: this also clears a stale 'error' or
    // 'revoked' (e.g. a missed LOGIN_REPAIRED webhook).
    status: errorCode ? (isRevokedErrorCode(errorCode) ? "revoked" : "error") : "good",
    error_code: errorCode,
    consent_expiration_time: consent,
    status_checked_at: now.toISOString(),
  };

  // Only overwrite the timestamps Plaid actually reported. A missing status
  // block must not erase what we knew, or a healthy old Item would look like it
  // has never updated and read as delayed.
  if (typeof tx?.last_successful_update === "string") {
    patch.last_successful_update = tx.last_successful_update;
  }
  if (typeof tx?.last_failed_update === "string") {
    patch.last_failed_update = tx.last_failed_update;
  }

  // Consent now runs well past the warning window: it was renewed (possibly in
  // another app), so a PENDING_DISCONNECT warning no longer applies.
  const consentMs = consent ? Date.parse(consent) : NaN;
  if (!Number.isNaN(consentMs) && consentMs - now.getTime() > EXPIRING_WITHIN_MS) {
    patch.disconnect_warned_at = null;
  }

  return patch;
}

/** Patch for a Plaid API call on this Item that failed with an Item error `errorCode`. */
export function statusPatchFromError(errorCode: string): ItemStatusPatch {
  return {
    status: isRevokedErrorCode(errorCode) ? "revoked" : "error",
    error_code: errorCode,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export const ITEM_HEALTH_COLUMNS =
  "plaid_item_id, institution_name, status, error_code, last_successful_update, last_failed_update, consent_expiration_time, disconnect_warned_at, status_checked_at, created_at";

export type ItemHealthRow = {
  plaid_item_id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  last_successful_update: string | null;
  last_failed_update: string | null;
  consent_expiration_time: string | null;
  disconnect_warned_at: string | null;
  status_checked_at: string | null;
  created_at: string;
};

export type WriteOptions = {
  /**
   * Push "needs repair" if this write moves the Item into that state. On for
   * background paths (webhooks, cron); off when the user is in the app acting
   * on the connection themselves.
   */
  notify?: boolean;
};

/** True when going from `before` to `after` should send the "needs repair" push. */
export function shouldNotifyNeedsRepair(
  before: ItemHealthRow,
  after: ItemHealthRow,
  now: Date = new Date(),
): boolean {
  const b = deriveConnectionHealth(healthInputFromRow(before), now);
  const a = deriveConnectionHealth(healthInputFromRow(after), now);
  return a.state === "needs_repair" && b.state !== "needs_repair";
}

/**
 * Writes `patch` to the Item and, with `notify`, pushes when the Item newly
 * needs repair. Returns false if the Item doesn't exist.
 */
export async function applyItemPatch(
  client: SupabaseClient,
  plaidItemId: string,
  patch: ItemStatusPatch,
  { notify = false }: WriteOptions = {},
): Promise<boolean> {
  const { data: before, error: readError } = await client
    .from("plaid_items")
    .select(`${ITEM_HEALTH_COLUMNS}, plan_id`)
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!before) return false;

  const { error } = await client
    .from("plaid_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("plaid_item_id", plaidItemId);
  if (error) throw new Error(error.message);

  const row = before as ItemHealthRow & { plan_id: string };
  if (notify && shouldNotifyNeedsRepair(row, { ...row, ...patch })) {
    try {
      await sendPushToPlan(client, row.plan_id, {
        title: "Bank connection needs repair",
        body: `${row.institution_name ?? "A bank connection"} needs you to reconnect it`,
        url: "/accounts",
      });
    } catch (e) {
      console.error(`[plaid] needs-repair push failed for item ${plaidItemId}`, e);
    }
  }
  return true;
}

type ItemRef = { plaid_item_id: string; access_token: string };

/**
 * Calls /item/get and records the Item's error, update timestamps and consent
 * expiry. An Item error from /item/get itself (e.g. ITEM_NOT_FOUND) is recorded
 * rather than thrown; anything else is thrown.
 */
export async function refreshItemStatus(
  client: SupabaseClient,
  item: ItemRef,
  options: WriteOptions = {},
): Promise<ItemStatusPatch> {
  const plaid = createPlaidClient();
  let patch: ItemStatusPatch;
  try {
    const res = await plaid.itemGet({ access_token: item.access_token });
    patch = statusPatchFromItemGet(res.data);
  } catch (e) {
    const code = itemErrorCode(e);
    if (!code) throw e;
    patch = { ...statusPatchFromError(code), status_checked_at: new Date().toISOString() };
  }
  await applyItemPatch(client, item.plaid_item_id, patch, options);
  return patch;
}

/** Records a failed Plaid call's error on the Item, if it was an Item error. */
export async function recordItemError(
  client: SupabaseClient,
  plaidItemId: string,
  err: unknown,
  options: WriteOptions = {},
): Promise<void> {
  const code = itemErrorCode(err);
  if (!code) return;
  await applyItemPatch(client, plaidItemId, statusPatchFromError(code), options);
}

/** After a successful update-mode Link session: the Item is usable and renewed. */
export async function markItemRepaired(
  client: SupabaseClient,
  plaidItemId: string,
): Promise<void> {
  await applyItemPatch(client, plaidItemId, {
    status: "good",
    error_code: null,
    disconnect_warned_at: null,
  });
}

/**
 * syncItem, plus keeping connection health current: an Item error from the
 * sync is recorded (then the error is rethrown), and a successful sync is
 * followed by a /item/get refresh. A refresh failure is logged, never thrown —
 * the sync itself already succeeded and saved its cursor.
 */
export async function syncItemAndRefreshStatus(
  client: SupabaseClient,
  itemRow: Parameters<typeof syncItem>[1],
  options: WriteOptions = {},
): Promise<Awaited<ReturnType<typeof syncItem>>> {
  let result: Awaited<ReturnType<typeof syncItem>>;
  try {
    result = await syncItem(client, itemRow);
  } catch (e) {
    try {
      await recordItemError(client, itemRow.plaid_item_id, e, options);
    } catch (recordErr) {
      console.error("[plaid] failed to record item error", recordErr);
    }
    throw e;
  }

  try {
    await refreshItemStatus(client, itemRow, options);
  } catch (e) {
    console.error(`[plaid] status refresh failed for item ${itemRow.plaid_item_id}`, e);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading health back for the UI
// ---------------------------------------------------------------------------

export function healthInputFromRow(row: ItemHealthRow): ConnectionHealthInput {
  return {
    status: row.status,
    errorCode: row.error_code,
    lastSuccessfulUpdate: row.last_successful_update,
    lastFailedUpdate: row.last_failed_update,
    consentExpirationTime: row.consent_expiration_time,
    disconnectWarnedAt: row.disconnect_warned_at,
    statusCheckedAt: row.status_checked_at,
    createdAt: row.created_at,
  };
}

export function itemConnectionFromRow(row: ItemHealthRow, now: Date = new Date()): ItemConnection {
  return {
    ...deriveConnectionHealth(healthInputFromRow(row), now),
    plaidItemId: row.plaid_item_id,
    institutionName: row.institution_name,
    lastSuccessfulUpdate: row.last_successful_update,
  };
}

/**
 * Connection health for every Plaid Item the client can see, keyed by
 * plaid_item_id. Health is decoration on the accounts list, so a failed read
 * is logged and yields an empty map rather than failing the whole list.
 */
export async function loadItemConnections(
  client: SupabaseClient,
): Promise<Map<string, ItemConnection>> {
  const { data, error } = await client.from("plaid_items").select(ITEM_HEALTH_COLUMNS);
  if (error) {
    console.error("[plaid] failed to load connection health", error.message);
    return new Map();
  }
  const now = new Date();
  return new Map(
    ((data ?? []) as ItemHealthRow[]).map((row) => [
      row.plaid_item_id,
      itemConnectionFromRow(row, now),
    ]),
  );
}
