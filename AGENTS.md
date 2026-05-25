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

- Budget math (assigned, activity, available, rollover, ready-to-assign)
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
