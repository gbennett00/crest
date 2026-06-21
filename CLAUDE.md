# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Crest is a zero-based budgeting web app (YNAB-inspired) built with Next.js 15, Supabase (PostgreSQL), and TypeScript. The authoritative design reference is `docs/budgeting-app-architecture.md` — read it before implementing any feature, schema change, calculation, or UI flow.

## Commands

```bash
pnpm dev             # start Next.js dev server
pnpm build           # production build
pnpm lint            # ESLint
pnpm test            # run all tests once (vitest)
pnpm test:watch      # vitest in watch mode
pnpm vitest run path/to/foo.test.ts  # run a single test file
```

## Architecture

### Stack

- **Next.js 15** (App Router) — pages under `app/`, UI components under `components/`
- **Supabase** — auth + PostgreSQL database; migrations in `supabase/migrations/`
- **shadcn/ui** — component library; all UI primitives live in `components/ui/`, import from `@/components/ui`
- **Vitest** — test runner; tests co-located with source (`foo.ts` + `foo.test.ts`)

### Supabase clients

Three client factories, each for a different execution context:

- `lib/supabase/server.ts` — Server Components and Route Handlers (reads cookies)
- `lib/supabase/client.ts` — Client Components (browser)
- `lib/supabase/proxy.ts` — proxy/middleware context

Always create a new client per request; never cache the client in a module-level variable.

### Ledger library (`lib/ledger/`)

Pure TypeScript business logic — no direct DB calls in the core modules; operations that need Supabase are in `operations.ts`. Everything is exported through `lib/ledger/index.ts`.

| File                | Purpose                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`          | Shared types (`Cents`, all input/row types)                                                                                             |
| `constants.ts`      | `OPENING_BALANCE_IMPORTED_ID`, `OPENING_BALANCE_PAYEE`                                                                                  |
| `errors.ts`         | `LedgerError` class                                                                                                                     |
| `validation.ts`     | `assertIntegerCents`, `validateAllocations`, `validateCreditAccount`, etc.                                                              |
| `balance.ts`        | `approximateAvailableCents`, `sumClearedTransactionAmounts`, etc.                                                                       |
| `reconciliation.ts` | `checkReconciliation`, `RECONCILIATION_FIX_HINT`                                                                                        |
| `operations.ts`     | Supabase-backed ledger ops: `createAccount`, `createTransaction`, `upsertTransaction`, `createTransfer`, `evaluateReconciliation`, etc. |

### Database rules (enforced at DB level)

- All money is **`bigint` cents** — never floats
- Budget months are `DATE` values representing the **first day of the month**
- Derived values (available balances, activity totals, ready-to-assign) are **never stored** — always computed
- `transaction_allocations` must sum to the parent `transaction.amount_cents` when the transaction is approved (enforced by a deferred constraint trigger)
- Credit accounts require `payment_category_id`; non-credit accounts must not have one
- Transfers use the `ledger_create_transfer` SQL function for atomicity

### Domain model summary

- **Ledger** (transactions, transaction_allocations) — historical financial activity
- **Budget** (monthly_budgets, targets) — allocation decisions; kept strictly separate from ledger
- **Ready to Assign** — a system category (`role = 'ready_to_assign'`); exactly one row; inflows are categorized here, then assigned outward to spending categories
- **Group budgeting** — category groups with `budget_mode = 'group'` are assigned at the group level; individual categories within cannot receive assignments
- **Credit cards** — each credit account has a payment category; purchases move available from the spending category to the payment category

### Key invariants

- `amount_cents` sign convention: **negative = outflow, positive = inflow**
- `txn_date` is the economic/calendar date; `cleared_at` is bank workflow state — keep them separate
- Unapproved transactions (e.g. Plaid imports) may have zero splits; approved transactions must have at least one allocation
- `balance_cents` on accounts is the last Plaid-reported cleared balance, used only for reconciliation — not for any budget math

## Testing

Add unit tests whenever you add or change business logic or financial calculations. Use integer cents in fixtures, never floats. Tests live next to the code they cover.

## Verifying changes

Local Supabase is already running when you start work —
NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
are set in the environment, pointing at the local instance.

Before considering a frontend change done:

1. Run `npm run dev` (backgrounded) and confirm it starts cleanly
2. Hit the relevant route(s) on localhost to confirm the change works
3. Check for errors in the dev server output
4. Stop the dev server when done verifying
