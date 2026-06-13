# Plaid Integration Plan

Status: **planning** (pre-implementation). This plan is written against the architecture in
`docs/budgeting-app-architecture.md` and the current ledger code, but it is intentionally
described in terms of **module responsibilities and Plaid contracts**, not exact line numbers or
current function signatures, so that ongoing refactors don't invalidate it.

Everything about Plaid below is sourced from Plaid's API docs (June 2026):
`/link/token/create`, `/item/public_token/exchange`, `/item/remove`, `/item/get`,
`/transactions/sync`, Transactions/Item webhooks, and webhook verification.

---

## 1. Scope (MVP)

From the architecture doc, Plaid is an **import/sync layer**, not the core transaction system.
The ledger model must not be coupled to Plaid specifics. In scope for MVP:

- Link a bank login (Plaid **Item**) and create Crest `accounts` for its sub-accounts.
- Sync transactions via the cursor-based `/transactions/sync` endpoint.
- Imported transactions land **unapproved with no splits**, then flow through the existing
  approval UI (the schema already permits zero-split unapproved transactions).
- Dedupe/upsert by Plaid `transaction_id` using the existing `upsertTransaction` op
  (`imported_id` carries the Plaid `transaction_id`).
- Refresh bank cleared balances onto `accounts.balance_cents` for reconciliation
  (the existing `syncBankClearedBalance` already maps Plaid `current`).
- Webhook-driven incremental sync (`SYNC_UPDATES_AVAILABLE`) with a manual "Sync now" fallback.
- Unlink/remove an Item.

**Not in MVP:** OAuth-only institutions polish, update-mode re-auth UX beyond a basic prompt,
investments/liabilities, multi-user (there is no `user_id` column yet — single-user invariant).

---

## 2. The one true Plaid gotcha: amount sign convention

Plaid and Crest use **opposite** sign conventions. This is the single most important correctness
item in the integration.

| | Outflow (spending) | Inflow (deposit/refund) |
|---|---|---|
| **Plaid** `transaction.amount` | **positive** | **negative** |
| **Crest** `amount_cents` | **negative** | **positive** |

So the mapping is `crest_amount_cents = -round(plaid.amount * 100)`.

Plaid `amount` is a floating-point number in **major currency units** (e.g. `12.34`), so the
float→cents conversion must be done carefully (round, never truncate) and unit-tested. This is the
boundary where the architecture's "integer cents only" rule is most at risk.

Account balances have a parallel issue: Plaid reports credit-card balances as a **positive amount
owed**, whereas Crest stores credit balances as **negative** (debt is an outflow from the account).
The balance-sync mapping must mirror what `createManualAccount` already does for credit accounts.

---

## 3. Plaid surfaces we will use (contracts)

### 3.1 SDKs / environment
- Server: `plaid` npm package. Initialize once per request context (mirror the Supabase
  "never cache a module-global client" rule, or treat the Plaid client as stateless config):
  `new PlaidApi(new Configuration({ basePath: PlaidEnvironments.sandbox, baseOptions: { headers: { 'PLAID-CLIENT-ID': ..., 'PLAID-SECRET': ... } } }))`.
- Client: `react-plaid-link` (`usePlaidLink({ token, onSuccess })`; exposes `open`, `ready`).
- Start in **sandbox** (`PlaidEnvironments.sandbox`); test creds `user_good` / `pass_good`;
  `/sandbox/item/fire_webhook` to exercise the webhook path.

### 3.2 `/link/token/create` → `linkTokenCreate`
- Request (required): `client_name` (≤30 chars), `language`, `country_codes[]`,
  `user.client_user_id`, `products[]` (we use `['transactions']`).
- Request (optional, we use): `webhook` (our webhook URL), `redirect_uri` (only for OAuth),
  `transactions.days_requested` (1–730; pick e.g. 90 for MVP), `access_token` (update mode only).
- Response: `link_token`, `expiration` (ISO 8601), `request_id`.

### 3.3 `/item/public_token/exchange` → `itemPublicTokenExchange`
- Request: `public_token` (from Link's `onSuccess`; expires after 30 min).
- Response: `access_token` (long-lived secret), `item_id`, `request_id`.

### 3.4 `/transactions/sync` → `transactionsSync`
- Request: `access_token` (required), `cursor` (omit for full history; otherwise the stored
  per-Item cursor), `count` (1–500, default 100), `options.include_original_description`,
  `options.personal_finance_category_version`.
- Response: `added[]`, `modified[]`, `removed[]` (each has only `transaction_id`),
  `next_cursor`, `has_more`, `accounts[]`, `transactions_update_status`.
- Transaction object fields we map: `transaction_id`, `account_id`, `amount`, `iso_currency_code`,
  `date` (posted/occurred — maps to Crest `txn_date`), `authorized_date`, `name`,
  `merchant_name`, `pending`, `pending_transaction_id`, `personal_finance_category`,
  `payment_channel`.
- **Pagination contract:** loop while `has_more` is true, passing `next_cursor` each time; persist
  the final `next_cursor` only after the whole page set is applied. If any page fails, restart the
  loop from the **original** cursor (sync is designed to be replayed idempotently).

### 3.5 Item lifecycle: `/item/get`, `/item/remove`
- `/item/get` → item object (`item_id`, `institution_id`, `institution_name`, `webhook`,
  `error`, `available_products`, `billed_products`, `products`, `consent_expiration_time`,
  `update_type`). Used for institution name + surfacing item errors.
- `/item/remove` → request `access_token`; invalidates the token. Called on unlink.

### 3.6 Webhooks
- **Transactions:** `SYNC_UPDATES_AVAILABLE` (`webhook_type: TRANSACTIONS`). Payload:
  `webhook_type`, `webhook_code`, `item_id`, `initial_update_complete`,
  `historical_update_complete`. Flow: receive → look up Item by `item_id` → run the sync loop from
  the stored cursor.
- **Item:** `webhook_type: ITEM` codes such as `ERROR`, `PENDING_EXPIRATION`,
  `USER_PERMISSION_REVOKED` — record the item error/status so the UI can prompt re-link.
- **Verification** (`Plaid-Verification` header = ES256 JWT):
  1. decode JWT header, confirm `alg = ES256`, read `kid`;
  2. call `/webhook_verification_key/get` with `kid` → JWK (cache by `kid`);
  3. verify JWT signature against the JWK;
  4. confirm `iat` is within 5 minutes;
  5. compute SHA-256 of the **raw request body** and constant-time compare to the JWT's
     `request_body_sha256`.
  The webhook route must read the **unparsed raw body** for hashing (don't let a framework parse
  it first). Plaid's Node examples do this manually with `jose` — there is no SDK one-liner.

---

## 4. Data model changes

### 4.1 New table: `plaid_items` (new migration)
`accounts` already has `plaid_item_id` / `plaid_account_id` (text), but there is **nowhere to store
the access token or the sync cursor** — this table is the core schema addition.

Proposed columns (bigint cents rule doesn't apply here; this is connection metadata):
- `id` (uuid pk)
- `plaid_item_id` (text, unique) — Plaid `item_id`
- `access_token` (text) — Plaid access token (see §7 on protecting this)
- `institution_id` (text, nullable), `institution_name` (text, nullable)
- `transactions_cursor` (text, nullable) — last `next_cursor` from `/transactions/sync`
- `status` (text) — `good` / `login_required` / `error` etc., driven by item webhooks
- `error_code` (text, nullable)
- `created_at`, `updated_at`

RLS: follow the existing `authenticated_all` pattern. **But** webhooks have no user session, so the
webhook handler must use a **service-role** Supabase client (see §7) which bypasses RLS.

### 4.2 `accounts` (no structural change needed)
- `plaid_item_id` → FK-by-value to `plaid_items.plaid_item_id` (or add a real uuid FK later).
- `plaid_account_id` ← Plaid `account_id`.
- `is_linked = true`.
- `type` ← mapped from Plaid `account.type`/`subtype` → `'checking' | 'savings' | 'credit'`.
- Credit accounts still require a `payment_category_id` (existing constraint) — linking a credit
  card must create/choose a payment category, reusing the "Credit Cards" group logic that
  `createManualAccount` already implements.

### 4.3 Transactions (no structural change)
- `imported_id` ← Plaid `transaction_id` (unique per `(account_id, imported_id)` already enforced).
- Imported transactions: `approved_at = null`, **no allocations** — surfaced in the approval UI.
- `txn_date` ← Plaid `date`. `cleared_at` ← set when `pending = false`, null when `pending = true`.
- `payee` ← `merchant_name ?? name`.

---

## 5. New code modules

Keep Plaid isolated so the ledger stays Plaid-agnostic (architecture guardrail).

### 5.1 `lib/plaid/client.ts`
Constructs the `PlaidApi` from env (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`).

### 5.2 `lib/plaid/mapping.ts` (pure, unit-tested — no DB, no network)
The correctness core. Pure functions:
- `plaidAmountToCents(amount: number): Cents` — `-round(amount * 100)` (sign flip + float→cents).
- `plaidBalanceToBalanceCents(plaidAccount): Cents` — current balance → `balance_cents`, applying
  the credit-account negation so it matches `createManualAccount`.
- `plaidAccountTypeToCrest(type, subtype): AccountType`.
- `plaidTxnToUpsertInput(txn, crestAccountId): UpsertTransactionInput` — assembles
  `{ accountId, amountCents, txnDate, payee, memo, importedId, clearedAt, approvedAt: null }`.

These mirror the existing `lib/ledger` style (pure logic, integer cents, co-located `.test.ts`).
Tests use integer-cents fixtures and explicit Plaid sample payloads.

### 5.3 `lib/plaid/sync.ts` (DB-backed orchestration)
- `syncItem(serviceClient, plaidItem)`:
  1. loop `/transactions/sync` from `plaidItem.transactions_cursor` until `has_more = false`,
     accumulating `added`/`modified`/`removed` and the final `next_cursor`;
  2. resolve each Plaid `account_id` → Crest account (via `plaid_account_id`); create missing
     accounts from the `accounts[]` payload on first sync;
  3. apply `added`+`modified` through `upsertTransaction` (dedupe by `imported_id`);
  4. handle posted-over-pending: when a posted txn has `pending_transaction_id`, delete the prior
     imported row whose `imported_id == pending_transaction_id` (so the pending line is replaced,
     not duplicated);
  5. apply `removed[]` by deleting transactions whose `imported_id` matches;
  6. refresh balances via `syncBankClearedBalance` using the mapped `accounts[]` balances;
  7. persist `next_cursor` to `plaid_items` **only after** the page set applied successfully.

Idempotency comes from `upsertTransaction` + the unique `(account_id, imported_id)` index, so a
replayed sync is safe.

### 5.4 Server actions — `app/(app)/accounts/actions.ts` (extend)
- `createLinkToken()` → returns `link_token` for the client.
- `exchangePublicToken(publicToken)` → exchange, insert `plaid_items`, fetch `/item/get` for
  institution name, create Crest accounts, then run an initial `syncItem`.
- `syncLinkedItem(itemId)` → manual "Sync now".
- `unlinkItem(itemId)` → `/item/remove`, then deactivate/detach accounts.

### 5.5 Webhook route — `app/api/plaid/webhook/route.ts`
- Reads the **raw body**, verifies the `Plaid-Verification` JWT (§3.6), then dispatches:
  - `TRANSACTIONS / SYNC_UPDATES_AVAILABLE` → `syncItem`.
  - `ITEM / *` → update `plaid_items.status`/`error_code`.
- Uses the **service-role** Supabase client (no user session on webhook requests).
- Returns 200 quickly; do the sync work within the handler (acceptable for single-user MVP).

### 5.6 Client — Link button
`react-plaid-link`'s `usePlaidLink({ token, onSuccess })`; on success, call
`exchangePublicToken(public_token)` server action and refresh the accounts page.

---

## 6. Environment & config (new)

Add to `.env` (and document in README):
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV` (`sandbox` to start)
- `PLAID_WEBHOOK_URL` (public HTTPS; use a tunnel in dev)
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only**, never `NEXT_PUBLIC_`; required so the webhook
  handler can write without a user session.

A new `lib/supabase/service.ts` factory creates a service-role client for the webhook path only.

---

## 7. Security notes

- `access_token` and the service-role key are **bearer secrets**. Keep the access token server-side
  only; never return it to the client. Consider encrypting it at rest (pgcrypto / app-level)
  before storing in `plaid_items` — decide during testing.
- The webhook is a public endpoint: **JWT verification is mandatory** before acting on any payload.
- Service-role client bypasses RLS — use it **only** in the webhook handler, never in user-facing
  request paths.

---

## 8. Suggested build order

1. Migration: `plaid_items` table (+ service-role docs). No app behavior yet.
2. `lib/plaid/mapping.ts` + tests (sign flip, balance, type, txn mapping) — pure, highest-risk.
3. `lib/plaid/client.ts` + env wiring.
4. Server actions: link token → exchange → initial sync (manual trigger first, no webhook).
5. Link button UI on the accounts page; verify accounts + unapproved transactions appear.
6. `lib/plaid/sync.ts` full loop incl. pending→posted replacement and `removed[]`.
7. Webhook route + JWT verification; test with `/sandbox/item/fire_webhook`.
8. Unlink (`/item/remove`) + item-error surfacing.
9. Reconciliation pass: confirm synced cleared balances reconcile against the register.

Each step is independently testable; steps 1–3 and the mapping tests have no UI dependency.

---

## 9. Open questions to settle during testing

- **Account type mapping:** confirm the Plaid `subtype` → Crest `type` table against the real
  institutions you test (e.g. `money market`/`cd` → `savings`?).
- **Credit balance sign:** verify against a sandbox credit card that the mapped `balance_cents`
  reconciles (Plaid `current` positive-owed vs Crest negative-debt).
- **Pending handling:** confirm whether you want pending transactions imported at all, or only
  posted ones. The plan imports both and replaces on posting via `pending_transaction_id`.
- **`days_requested`:** how much history to pull on first link (90 vs more).
- **Access-token encryption:** plaintext column vs encrypted at rest.
- **Webhook in dev:** which tunnel (and whether to also poll on app open as a fallback).
