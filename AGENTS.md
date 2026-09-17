# Crest — agent instructions

This repo is a zero-based budgeting web app. **`docs/budgeting-app-architecture.md` is the project outline** — read it before implementing features, schema changes, calculations, or UI.

Use that document for:

- **Database schema** — tables, fields, constraints, and what must *not* be stored (e.g. derived balances)
- **Business rules** — ledger vs budget separation, credit cards, splits, group budgeting, reconciliation, Plaid import
- **Calculations** — how available amounts, activity, ready-to-assign, and category balances are derived (see *Core Calculations*, *Group Budgeting Rules*, *Credit Card Logic*)
- **UI direction** — mobile-first screens, flows, and MVP scope

Do not contradict the architecture doc unless the user explicitly overrides it.

## Testing

**Always add unit tests when you add or change business logic or financial calculations.**

That includes (non-exhaustive):

- Budget math (assigned, activity, available, rollover, Ready to Assign category)
- Group-level budgeting aggregation
- Credit-card payment / debt movement logic
- Transaction split validation and allocation rules
- Any pure functions that transform cents, dates, or budget months

Prefer small, focused tests with explicit inputs and expected cent amounts. Use integer cents in fixtures — never floats for money.

Co-locate tests next to the code they cover (e.g. `foo.ts` + `foo.test.ts`) or follow whatever test layout exists once a runner is configured.

UI-only changes (layout, styling, copy) do not require new tests unless they embed calculation logic.

## UI components

Use **[shadcn/ui](https://ui.shadcn.com/)** for all UI. Import from `@/components/ui` (e.g. `Button`, `Card`, `Input`, `Label`).

- Prefer existing components in `components/ui/` over custom primitives or other UI libraries.
- If a needed component is missing, add it with the shadcn CLI (`npx shadcn@latest add <component>`) rather than building from scratch.
- Compose feature UI from shadcn primitives; extend via variants/props before inventing one-off styled elements.

## Implementation habits

- Money is always **integer cents** (`bigint` in the DB).
- **Compute** derived budget state; do not persist available balances, activity totals, or similar aggregates.
- Keep **ledger** (transactions) and **budget** (allocations) separate.
- Prefer database constraints for integrity where the architecture doc specifies them.
- Match existing code style and keep diffs minimal.

## Client-side data caching

**The problem this solves:** a plain Server Component re-fetches on every
visit, including a "back" navigation to a screen the user was just on. Next's
Router Cache (`staleTimes` in `next.config.ts`) only papers over this for the
exact same route+params, and gets invalidated wholesale by any
`revalidatePath` on that route — so on a frequently-mutated screen (e.g.
budget assignment) it rarely stays warm. For the app's main "hub" screens —
**Budget, Transactions (category register + edit), Accounts (list +
register), Home** — data instead lives in a client-side [TanStack
Query](https://tanstack.com/query) cache, so a revisit renders from memory
instantly instead of re-hitting Postgres. Writes are still fine to be a bit
slower; **reads and screen switches should feel instant.**

### The shape of it

1. **An API route mirrors what the old Server Component fetched.** e.g.
   `app/api/budget-view/route.ts` runs the same query `budget/page.tsx` used
   to run, just returns it as JSON instead of rendering.
2. **A resource is defined once with `defineQuery`** (`lib/queries/define-query.ts`):
   ```ts
   const thingQuery = defineQuery("thing", async (id: string) => {
     const res = await fetch(`/api/thing/${id}`);
     if (!res.ok) throw new Error("Failed to load thing");
     return res.json();
   });
   export const useThing = (id: string) => thingQuery.useResource([id]);
   export const prefetchThing = (qc: QueryClient, id: string) => thingQuery.prefetch(qc, id);
   ```
   This gives a `useQuery` hook plus `prefetch`/`invalidate` helpers that all
   share one query key, under the shared `["ledger", ...]` root.
3. **The page becomes a thin client component** with **no server-side data
   fetch of its own** — see `app/(app)/budget/page.tsx`,
   `app/(app)/accounts/page.tsx`, `app/(app)/accounts/[id]/page.tsx`,
   `app/(app)/transactions/[id]/page.tsx`, `app/(app)/page.tsx`. It just reads
   `useParams`/`useSearchParams` and calls the resource's `useX()` hook,
   rendering a skeleton while `isPending && !data`. This is deliberate: a page
   that still fetches server-side on every navigation defeats the whole
   point, because the client cache never gets a chance to serve the request.
4. **Prefetch on intent**, not just on load: a row/card that links into a
   cached resource calls `prefetchX(queryClient, ...)` from
   `onMouseEnter`/`onFocus`/`onPointerDown` (the last one matters for
   touch — there's no hover on mobile). See `CategoryRow` in
   `budget-screen.tsx`, `AccountCard`, or the transaction rows in
   `register-transaction-list.tsx` / `transactions/page.tsx`. The nav bar
   (`components/nav.tsx`) also eagerly warms Home/Budget/Accounts/Reports on
   mount so the very first tab switch is instant, not just the second.
5. **Every mutation invalidates the cache it affects.** A Server Action's own
   `revalidatePath` only touches Next's RSC cache — it does *not* reach this
   client-side cache, so skipping this step means the UI goes stale and stays
   stale. Two invalidation styles, pick based on how hot the path is:
   - **Scoped** (`invalidateBudgetView(queryClient, month)`,
     `budgetViewKey(month)`) for a single, frequent, well-understood
     mutation — e.g. assigning one category in one month. Only refetches
     that one cache entry.
   - **Broad** (`invalidateAllLedgerQueries(queryClient)` from
     `lib/queries/define-query.ts`) for anything rarer or with a
     cross-cutting blast radius (renaming, targets, reorder, reconciling,
     closing an account, saving/deleting a transaction — which can move
     budget activity, an account balance, and the home dashboard all at
     once). This is the safe default: invalidating only marks
     currently-mounted queries stale, it does not eagerly refetch
     everything, so reaching for it is cheap. Prefer it unless you have a
     specific reason to scope down.

### When *not* to do this

Every top-level nav destination (Home, Budget, Accounts + register, Reports
dashboard + spending, Transactions + edit) goes through this pattern now. A
one-off flow like `app/(app)/import/*` (the YNAB import wizard) is still a
plain Server Component fetching on each request — that's fine. Only convert
a page once it's actually a "hub" users bounce in and out of repeatedly; a
page visited once per session doesn't benefit from a client cache and it's
not worth the extra API-route indirection.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
