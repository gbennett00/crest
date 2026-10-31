# Instant-Feel Plan: persisted cache, cached shell, optimistic writes

Status: **planning** (pre-implementation). Goal: page loads feel instant like a native app, and
writes (especially approving transactions) feel immediate. Written in terms of modules and
contracts rather than line numbers so ongoing refactors don't invalidate it. Complements the
"Client-side data caching" section of `AGENTS.md`.

We considered a full local-first rewrite (TanStack DB + a sync engine such as Electric or
PowerSync) and rejected it for now: the budget math (`lib/budget/compute.ts`, SQL views) would have
to run on the client, mutations would need rewriting as optimistic collection mutations, and
Plaid import / multi-user plan scoping all become sync-scoping problems. The incremental plan
below gets most of the perceived speed. Revisit TanStack DB only if we later want offline writes
or live cross-device sync.

---

## 1. Findings (current state)

**Reads.** Home, Budget, Accounts and Transactions already read from the TanStack Query cache
(`lib/queries/*`, built with `defineQuery`) and have no server fetch of their own. But the cache is
memory-only (`gcTime` 30 min), so a cold PWA launch has nothing to show and renders a skeleton
until `/api/home` or `/api/budget-view` returns. `public/sw.js` caches only `/_next/static/*`; the
HTML document always needs the network.

**Writes.** Approving is slow for three reasons (read from code; Phase 0 verifies with timings):

1. `bulkApproveTransactions` awaits one `updateTransaction` per row, sequentially: N rows is N
   sequential Supabase round-trips.
2. Every action ends with `revalidateAll()` (`revalidatePath` on `/accounts`, `/`, `/budget`).
   Server Actions return a re-rendered RSC payload for the current route when `revalidatePath` is
   called. Most screens are client-fetched now, so this mostly adds work to the response.
3. The client then calls `invalidateAllLedgerQueries()`, refetching `/api/home`, which runs
   `getHomeData()`. The approved row stays on screen until that refetch lands, which is the
   "just-saved transaction lingers for a few seconds" symptom. `bulk-actions-bar.tsx` also holds
   the bar in a pending state for the whole round-trip via `startTransition`.

---

## 2. Phase 0: Measure

Land this first (small, mergeable on its own) so every later phase can be proven.

- `performance.mark`/`measure` around the approve flow: click, action resolved, refetch resolved,
  row gone from the list.
- Server timing for `bulkApproveTransactions`, `/api/home` and `/api/budget-view` (e.g. a
  `Server-Timing` header or structured log).
- Cold-launch metrics on a production build (`pnpm build && pnpm start`; router prefetch does not
  run in `next dev`), throttled to Fast 4G: time to first meaningful content on `/` and `/budget`.
- Record baseline numbers in the PR description.

### What's instrumented

**Client** (`lib/perf.ts`, `lib/use-perf.ts`). Entries go into a localStorage ring buffer (last
300 entries, durations only), so they can be collected on a phone without devtools. Read them at
**`/dev/perf`**, which shows median/p90/max per flow and step and has Copy JSON and Clear buttons.
Unlike the other `/dev` pages it is available in production, because the baseline has to come from
the real deployment. In development each entry is also logged to the console as `[perf]`.

| Flow | Steps (ms from the tap) | Where |
| --- | --- | --- |
| `bulk-approve`, `bulk-categorize`, `bulk-move`, `bulk-delete` | `action` (server action returned), `refetch` (ledger refetch landed), `painted` (next frame after that, i.e. rows gone) | `bulk-actions-bar.tsx` |
| `txn-save`, `transfer-approve` | `action`, `refetch` | `transaction-form.tsx` |
| `first-content` | step is the screen (`home`, `budget`); ms from navigation start to the first render with real data. Only recorded when that screen is the URL the document loaded (cold launch or reload) | `useScreenTiming` |
| `stale-shown` | step is the screen; how long the screen showed cached data while the refetch triggered by mounting it was in flight | `useScreenTiming` |

`txn-save` meta has `pending: true` when the saved transaction was unapproved, i.e. an approval
from the edit page.

**Server** (`lib/server-timing.ts`). `/api/home`, `/api/budget-view` and `/api/transactions` send a
`Server-Timing` header with one span per parallel load plus `total` (devtools, Network, Timing).
`bulkApproveTransactions` (spans `load`, `updates`) and `saveTransaction` log one `[timing]` line
per call. Logging is off unless `CREST_TIMING=1` is set (Vercel env var for the baseline window).

### Collecting the baseline

1. Set `CREST_TIMING=1` on the Vercel deployment.
2. On the phone (installed PWA), open `/dev/perf` and Clear.
3. Use the app normally for a few days: cold-launch it, approve from Home (bulk and from the edit
   page), switch between Budget and Home.
4. Copy JSON from `/dev/perf` and pull the `[timing]` lines from Vercel runtime logs.
5. Record medians and p90s in the Phase 1 and Phase 2 PRs as the "before" numbers.

### First local run (local Supabase, `next dev`, 40 pending transactions)

Local numbers have no network latency to Supabase, so they understate production. They are useful
for the split between steps, not the absolute times.

- Bulk approve of 3 rows: action ~190-290 ms on the client, of which the server action's own work
  was ~110-150 ms (`updates` ~35-45 ms per row, sequential). The rest of `action` is the
  `revalidatePath` re-render and transport. `refetch` lands ~220-260 ms after `action`.
- Edit-page save of a pending transaction: action ~180-350 ms, refetch ~220-320 ms after.
- `/api/home` warm: ~110-220 ms total; `budget` and `pending` are the slowest spans.

### Findings from instrumenting

- **`/api/home` refetches after every ledger write, on every screen.** `components/add-transaction.tsx`
  (the global Add button) calls `useHomeView()`, which keeps `home-view` an active query, so
  `invalidateAllLedgerQueries` always refetches the heaviest endpoint. Phase 2 should either stop
  that component observing the whole home view (it only needs accounts/categories) or have
  mutations invalidate more narrowly.
- **The edit-page approve flow refetches Home before navigating to it.** Because of the above,
  `/api/home` refetches while the edit page is still showing, so by the time Home renders, the
  approved row is usually already gone. The wait is spent on the edit page instead: action, then
  `router.push` plus `router.refresh()` (an extra RSC round-trip). Phase 1's optimistic update
  should cover this path too, and Phase 2 should drop the `router.refresh()` if nothing
  server-rendered needs it.

## 3. Phase 1: Optimistic mutations (client)

1. **Helper in `lib/queries/`** implementing the standard sequence: cancel in-flight queries under
   `LEDGER_ROOT`, snapshot affected data, patch with `setQueriesData`, restore the snapshot on
   error, invalidate in the background on settle (never awaited by the UI).
2. **Patchers are pure functions** over query data (unit-tested, integer-cent fixtures):
   - `home-view`: remove the transaction from `pending`; adjust `budgetData` only where it is
     trivially derivable.
   - `all-transactions` and account register: flip approval state and category in place.
   - `transaction-detail` for touched ids.
   - `budget-view` activity/available: do **not** recompute client-side. `lib/budget/compute.ts`
     stays the single authority, and the background refetch corrects the numbers.
3. **Stop blocking the UI on the server.** In `bulk-actions-bar.tsx`, apply the patch, clear the
   selection and close the picker immediately, then fire the action. Failures surface as a toast
   or inline banner with retry.
4. **Partial results.** `BulkResult` is `{updated, skipped, error}`. On `skipped > 0`, roll back
   only the skipped ids and let the background refetch reconcile the rest.
5. **Rollout order** (by usage): bulk approve and single-row approve on Home, category change in
   the register, budget assignment (already has a scoped per-month path), delete. Remaining
   mutations are follow-ups.

## 4. Phase 2: Faster server actions

1. **Batch the writes.** Replace the per-row `updateTransaction` loop with a single round-trip in
   one DB transaction. `20260816180000_bulk_ledger_writes.sql` suggests a bulk RPC may already
   exist; use it if it fits, otherwise add a `ledger_bulk_approve` RPC. Run independent lookups
   with `Promise.all`.
2. **Drop `revalidatePath` where nothing server-rendered depends on it.** First grep for callers
   of `getHomeData`/`getBudgetView`/other server-side fetches to find which routes still need it.
   Revisit `experimental.staleTimes` in `next.config.ts` at the same time.
3. **Profile `getHomeData()`** and parallelise or consolidate its queries if `/api/home` is the
   slow part of the background refetch.
4. **Tests.** Any change to `ledger_*` SQL gets a pgTAP test in `supabase/tests/`; TS changes get
   Vitest coverage (integer cents).

### Parallelising Phases 0, 1 and 2

Phase 2 (server) can run in parallel with Phases 0 and 1 (client), because they touch different
layers. Constraints to keep them from colliding:

- **Freeze the action contract.** Keep the `BulkResult` shape (`{updated, skipped, error}`) and
  action signatures unchanged in Phase 2. Phase 1 builds against that contract, so either side can
  land first.
- **Land Phase 0 first.** It is small and gives both streams the same baseline measurements.
- **Shared file:** `app/(app)/transactions/actions.ts` (Phase 2 rewrites the loop and removes
  `revalidateAll`; Phase 1 only reads its types). Keep Phase 1 changes out of this file.
- **Removing `revalidatePath` is safe only with Phase 1's background invalidation in place**, or
  non-optimistic callers will show stale data. Merge that part of Phase 2 after Phase 1, or verify
  every caller still invalidates the client cache.
- Use separate branches and PRs per phase; merge order: 0, then 1 and 2 in either order, then the
  `revalidatePath` removal.

---

## 5. Phase 3: Persist the query cache

1. Add `@tanstack/react-query-persist-client` and `idb-keyval` (async IndexedDB persister;
   localStorage is too small and synchronous).
2. In `lib/query-client.tsx`, switch to `PersistQueryClientProvider`:
   - Persist only successful queries under `LEDGER_ROOT` (`shouldDehydrateQuery`); skip pending,
     errored and non-ledger queries. Throttle writes (~1s).
   - Set persister `maxAge` (e.g. 7 days) and `gcTime` to match, otherwise restored entries are
     dropped by in-memory GC.
   - `buster` derived from the deploy id (e.g. `VERCEL_GIT_COMMIT_SHA`) so a deploy that changes
     response shapes discards old cache.
3. **Scope the persisted store by user id and active plan id**, so switching plans or accounts on
   a shared device never shows another user's data.
4. **Wipe on sign-out** (`user-menu.tsx` logout flow): clear IndexedDB and the in-memory cache.
   Decide whether `PrivacyMode` should blur restored data on first paint.
5. **Render cached data immediately, then revalidate.** Keep `staleTime` low enough that a launch
   refetches, but never show a skeleton when cached data exists (`useHasMounted` currently forces
   skeletons on first render; adjust). Add a subtle last-synced/"Updating" indicator so stale
   balances are never shown silently.
6. Reconcile `initialData` in `useBudgetView` with persisted data so they don't fight over
   `dataUpdatedAt`.

## 6. Phase 4: Cached app shell (service worker)

Highest risk; needs hands-on testing in an installed PWA on a phone.

1. Precache the `/` document and critical `/_next/static` assets on install. Serve navigations
   stale-while-revalidate. Keep cache-first for hashed `/_next/static/*`.
2. **Never cache user data in the SW.** Exclude `/api/*`, `/auth/*`, `/invite/*` and RSC requests
   (`RSC` header / `_rsc` param). User data lives only in the Query cache / IndexedDB so there is
   one place to wipe on logout.
3. **Auth.** A cached shell bypasses server-side redirects. Verify how `lib/supabase/proxy.ts`
   behaves and make the shell check the session client-side and redirect to login when absent.
4. **Deploy skew.** Versioned shell cache, delete old versions on `activate` (as `sw.js` already
   does for assets), precache the chunks the shell references, fall back to network on miss.
   Replace `skipWaiting` with an "Update available, reload" prompt.
5. `cacheComponents: true` is enabled: inspect what the root document actually contains in a
   production build before deciding what is cacheable.

## 7. Phase 5: Polish

- Offline writes are out of scope; show "offline, can't save" instead. (Persisted paused-mutation
  queues need idempotent actions and conflict handling.)
- Launch-time prefetch of likely next screens (Budget, Transactions) after Home paints; keep the
  existing hover/focus prefetch.
- Consistent failure toast with retry for rolled-back optimistic writes.
- Playwright smoke test: approve makes the row vanish instantly, and reappears when the server is
  forced to fail.

---

## 8. Order, effort and risk

| Phase | Outcome | Effort | Risk |
| --- | --- | --- | --- |
| 0 Measure | Baseline numbers | ~1h | None |
| 1 Optimistic | Approvals feel instant | 1-2 days | Low-medium: wrong derived values (mitigated by background refetch) |
| 2 Fast actions | Real server time drops | 1-2 days | Medium: touches ledger SQL, needs pgTAP |
| 3 Persist cache | Cold launch shows data immediately | 1-2 days | Medium: stale or cross-user data, logout wipe |
| 4 SW shell | App opens without a network round-trip | 2-3 days | Highest: auth redirects, deploy skew |
| 5 Polish | Consistent feel, tests | ongoing | Low |

Recommended sequence: 0, then 1 and 2 in parallel, then 3, then 4.

## 9. Open questions

- Does an existing bulk RPC cover bulk approve, or do we need `ledger_bulk_approve`?
- Which routes (if any) still fetch server-side and therefore still need `revalidatePath`?
- Should restored data be blurred under Privacy Mode until revalidated?
- Is offline write support wanted at all, or is read-only offline enough?
