/**
 * Connection health for a Plaid Item: is it fine, temporarily delayed, or does
 * the user need to repair it? Pure functions, no Plaid or Supabase calls.
 *
 * The signals (all from Plaid, cached on plaid_items):
 *
 *   - `error_code`: the Item's error (from /item/get `item.error`, the
 *     ITEM: ERROR webhook, or a failed sync call).
 *   - `status`: our own summary, driven by ITEM webhooks — `pending_disconnect`
 *     (PENDING_DISCONNECT / PENDING_EXPIRATION: access ends in ~7 days) and
 *     `revoked` (USER_PERMISSION_REVOKED, or the access token stopped existing).
 *   - `last_successful_update`: the last time Plaid successfully checked the
 *     bank for transactions, *whether or not it found any*. This is what tells
 *     "quiet account" (recent) apart from "stalled connection" (old).
 *   - `last_failed_update`: the last time a check failed.
 *   - `consent_expiration_time`: when the Item's consent runs out, if the
 *     institution enforces one.
 *
 * Plaid checks for new transactions 1–4 times a day, so a gap of under a day is
 * normal and never reported.
 */

export type PlaidItemStatus = "good" | "error" | "pending_disconnect" | "revoked";

export type ConnectionHealthState = "ok" | "delayed" | "needs_repair";

export type ConnectionHealthReason =
  // needs_repair: fixed by Link update mode
  | "login_required"
  | "expiring"
  // needs_repair: the user must sort something out at the bank first, then repair
  | "bank_action_required"
  // needs_repair: Plaid lost access; update mode may work, otherwise relink
  | "revoked"
  // delayed: Plaid reports the institution itself is having trouble
  | "institution_issue"
  // delayed: no successful check for a while, no error to explain it
  | "stale";

export type ConnectionHealth = {
  state: ConnectionHealthState;
  reason: ConnectionHealthReason | null;
};

/** Health of one Plaid Item, as sent to the UI. */
export type ItemConnection = ConnectionHealth & {
  plaidItemId: string;
  institutionName: string | null;
  /** Last time Plaid successfully checked the bank (not "last new transaction"). */
  lastSuccessfulUpdate: string | null;
};

export type ConnectionHealthInput = {
  status: string;
  errorCode: string | null;
  lastSuccessfulUpdate: string | null;
  lastFailedUpdate: string | null;
  consentExpirationTime: string | null;
  statusCheckedAt: string | null;
  /** When the Item was linked; a brand-new Item has no successful update yet. */
  createdAt: string;
};

const HOUR_MS = 60 * 60 * 1000;

/** No successful check for this long, with recent failures since → delayed. */
export const FAILING_AFTER_MS = 24 * HOUR_MS;
/** No successful check for this long, whatever the reason → delayed. */
export const STALE_AFTER_MS = 48 * HOUR_MS;
/** Plaid sends PENDING_DISCONNECT seven days before consent expires; match it. */
export const EXPIRING_WITHIN_MS = 7 * 24 * HOUR_MS;

/**
 * Error codes the user fixes by re-authenticating in Link update mode.
 * ITEM_LOGIN_REQUIRED is by far the most common; the rest are variants Plaid
 * can leave on an Item after a failed update-mode attempt.
 */
const LOGIN_ERROR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "INVALID_OTP",
  "INVALID_UPDATED_USERNAME",
  "INSUFFICIENT_CREDENTIALS",
  "USER_INPUT_TIMEOUT",
  "ACCESS_NOT_GRANTED",
  "NO_ACCOUNTS",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
]);

/** The bank is blocking access until the user does something on its own site. */
const BANK_ACTION_ERROR_CODES = new Set([
  "ITEM_LOCKED",
  "PASSWORD_RESET_REQUIRED",
  "USER_SETUP_REQUIRED",
]);

/** The access token no longer refers to a usable Item. */
const REVOKED_ERROR_CODES = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

/**
 * Temporary problems on Plaid's or the institution's side. They clear without
 * the user doing anything, so they are "delayed", not "needs repair".
 */
const TRANSIENT_ERROR_CODES = new Set([
  "INSTITUTION_DOWN",
  "INSTITUTION_NOT_RESPONDING",
  "INSTITUTION_NOT_AVAILABLE",
  "INSTITUTION_REGISTRATION_REQUIRED",
  "PLANNED_MAINTENANCE",
  "PRODUCT_NOT_READY",
  "INTERNAL_SERVER_ERROR",
  "RATE_LIMIT_EXCEEDED",
  "TRANSACTIONS_LIMIT",
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
]);

export function isTransientErrorCode(code: string): boolean {
  return TRANSIENT_ERROR_CODES.has(code);
}

export function isRevokedErrorCode(code: string): boolean {
  return REVOKED_ERROR_CODES.has(code);
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

const OK: ConnectionHealth = { state: "ok", reason: null };

export function deriveConnectionHealth(
  input: ConnectionHealthInput,
  now: Date = new Date(),
): ConnectionHealth {
  const nowMs = now.getTime();

  // 1. Things only the user can fix.
  if (input.status === "revoked") {
    return { state: "needs_repair", reason: "revoked" };
  }

  const code = input.errorCode;
  if (code) {
    if (REVOKED_ERROR_CODES.has(code)) return { state: "needs_repair", reason: "revoked" };
    if (BANK_ACTION_ERROR_CODES.has(code)) {
      return { state: "needs_repair", reason: "bank_action_required" };
    }
    if (LOGIN_ERROR_CODES.has(code)) return { state: "needs_repair", reason: "login_required" };
    if (TRANSIENT_ERROR_CODES.has(code)) return { state: "delayed", reason: "institution_issue" };
    // Unknown code on the Item. Plaid's ITEM: ERROR webhook docs say an Item
    // error "can be resolved by having the user go through Link's update mode".
    return { state: "needs_repair", reason: "login_required" };
  }

  // An error status with no code means a webhook said "error" without saying
  // which one. Update mode is still the documented fix.
  if (input.status === "error") return { state: "needs_repair", reason: "login_required" };

  // 2. Still working, but about to stop.
  if (input.status === "pending_disconnect") {
    return { state: "needs_repair", reason: "expiring" };
  }
  const expires = ms(input.consentExpirationTime);
  if (expires !== null && expires - nowMs <= EXPIRING_WITHIN_MS) {
    return { state: "needs_repair", reason: "expiring" };
  }

  // 3. Healthy Item, but is Plaid actually reaching the bank?
  // Never checked: nothing to judge staleness on, so don't cry wolf.
  if (!input.statusCheckedAt) return OK;

  const lastSuccess = ms(input.lastSuccessfulUpdate);
  const lastFailure = ms(input.lastFailedUpdate);
  // A new Item has no successful update until Plaid's first pull finishes;
  // measure from link time instead.
  const since = lastSuccess ?? ms(input.createdAt) ?? nowMs;
  const age = nowMs - since;

  if (age >= STALE_AFTER_MS) return { state: "delayed", reason: "stale" };
  if (age >= FAILING_AFTER_MS && lastFailure !== null && lastFailure > since) {
    return { state: "delayed", reason: "stale" };
  }

  return OK;
}
