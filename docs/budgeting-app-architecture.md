Purpose: define the architectural rules, domain model, UI direction, and implementation constraints for a zero-based budgeting app inspired by YNAB, while supporting a custom group-level budgeting model.

This document is intended to be referenced by future implementation tasks. All contributors and AI agents should follow these rules unless explicitly overridden by a newer architectural decision.

---

## PRODUCT GOALS

Build a zero-based budgeting web app with:

* strict separation between ledger and budget logic
* support for credit cards
* support for split transactions
* support for manual accounts and linked accounts
* support for Plaid-based bank syncing
* group-level budgeting (custom feature)
* mobile-first UI design
* strong financial correctness over feature completeness

This is the MVP foundation.

---

## MVP FEATURES

Included in MVP:

* zero-based budgeting
* monthly budgeting only
* rollover between months
* account reconciliation
* manual transaction creation
* transaction upsert capability
* transaction splits
* credit card support
* group-level budgeting
* manual/unlinked accounts
* linked accounts via Plaid
* transaction approval flow
* mobile-first responsive UI

Not included in MVP:

* CSV import
* yearly obligations
* multi-user collaboration
* investments
* debt payoff planning
* forecasting
* recurring transaction engine
* goals beyond basic targets

---

## ARCHITECTURAL PRINCIPLES

1. Ledger and budget logic are separate.

Transactions represent historical financial activity.
Budgets represent allocation decisions.

Never merge these concepts.

2. Derived values are computed, not stored.

Examples:

* available amounts
* activity totals
* ready to assign
* category balances

These should be calculated from source-of-truth tables.

3. Financial correctness takes priority over convenience.

4. Database constraints should enforce integrity whenever possible.

5. All money values use integer cents.

Never use floating point numbers for currency.

6. Mobile-first UI.

All screens should be designed primarily for phones first, then enhanced for desktop/tablet layouts.

---

## DATABASE RULES

Database:

* PostgreSQL

Money:

* stored as bigint cents

Dates:

* budget months stored as DATE representing first day of month

Constraints:

* enforce integrity at DB level whenever possible

Never store:

* available balances
* activity totals
* computed budget state

---

## CORE DOMAIN MODEL

ACCOUNTS

Represents real-world financial accounts.

Fields:

* id
* name
* type

  * 'checking'
  * 'savings'
  * 'credit'
  * 'asset' — tracking (off-budget)
  * 'liability' — tracking (off-budget)
* on_budget — **generated column**, `type NOT IN ('asset', 'liability')`. Never set directly; derived from `type` so it can't drift out of sync the way a free-standing flag could.
* balance_cents — last **bank-reported cleared/posted** balance (Plaid `accounts.balance.current` on sync); used for reconciliation only; not updated by transactions
* payment_category_id (nullable, required for credit accounts)
* is_linked
* plaid_item_id (nullable)
* plaid_account_id (nullable)
* is_active
* created_at

Rules:

* credit accounts require a payment category
* linked accounts sync transactions via Plaid; balance sync writes Plaid `current` → `balance_cents`
* **opening balance** at link/create: one cleared, approved transaction (`imported_id = crest:opening_balance`, payee “Starting Balance”). On-budget accounts get a split to Ready to Assign — this holds for credit cards too (whose opening balance is negative debt), but credit-card opening balances are **excluded from the Ready to Assign total** so pre-existing debt does not reduce assignable cash (see READY TO ASSIGN and CREDIT CARD LOGIC). Tracking accounts (asset/liability) get **no allocation at all** — their starting balance is net worth, not budget cash.
* **working balance** (the default account figure everywhere in the UI, computed): sum(amount_cents) of **all** register lines, cleared and uncleared. This is the register's own truth and updates the instant a transaction is entered, so it never lags Plaid sync or reconciliation the way `balance_cents` does. On the account register it can be expanded into its cleared / uncleared split. `balance_cents` (the bank statement balance) is **not shown outside the reconcile flow**.
* **register cleared balance** (computed, for reconcile check + the working-balance split): sum(cleared transaction amounts), including the opening-balance line
* **approximate available balance** (legacy computed helper, no longer surfaced in the UI): `balance_cents` + sum(amount_cents) of uncleared register lines (`cleared_at IS NULL`)
* manual accounts are supported for testing (`createAccount` with `openingBalanceCents` seeds `balance_cents` and the opening transaction)

TRACKING ACCOUNTS (off-budget)

`asset` and `liability` accounts (YNAB's "tracking account" categories) feed
net worth but never the budget — the same distinction YNAB draws between its
budget and tracking account groups:

* their transactions flow through the full ledger like any other account —
  full history, `cleared_at`/`reconciled_at` state, everything
  `account_balances`/`account_monthly_balance` (and therefore the net worth
  report) rely on — but are **never categorized**: they carry no allocations
  and are always created already-approved. There is no "needs approval" step
  for a tracking account, because there is nothing to categorize.
* assumption baked into the app (not just current-state): tracking accounts
  are always manually entered, never Plaid-linked. If that changes later
  (YNAB does support linking a tracking account for balance-only sync), the
  UI/application-layer "always approve immediately" logic in
  `saveTransaction` and `createTransaction`/`updateTransaction` needs
  revisiting.
* the DB enforces the "no allocation required" side of this
  (`enforce_approved_transaction_has_allocations` / `enforce_transaction_splits_sum*`
  exempt `on_budget = false` accounts, alongside the existing transfer
  exemption); the "always approved, never categorized" side is enforced in
  application code, not the DB, since a hard DB constraint would preclude
  ever Plaid-linking a tracking account in the future.

---

TRANSACTIONS

Represents ledger activity.

Fields:

* id
* account_id
* amount_cents

  * negative = outflow
  * positive = inflow
* txn_date (DATE — register / budget month; not a workflow timestamp)
* payee
* memo
* transfer_account_id (nullable)
* imported_id (nullable)
* approved_at (nullable)
* cleared_at (nullable)
* reconciled_at (nullable)
* created_at

Rules:

* `txn_date` is the calendar date of the ledger line (from Plaid or user entry). It drives register ordering and which budget month activity falls in. Keep it separate from `cleared_at` — clearing is bank workflow, not the transaction’s economic date.
* approved transactions must have one or more splits that sum to `amount_cents`
* unapproved transactions (e.g. Plaid import) may have zero splits until the user approves
* **transfers are exempt**: a transaction with `transfer_account_id` set carries no allocations even when approved — its budget effect is derived from the transfer itself (see TRANSFERS), not from splits
* imported transactions may start as pending approval
* imported_id supports deduplication/upsert logic

---

TRANSACTION ALLOCATIONS

Fields:

* id
* transaction_id
* category_id
* amount_cents

Rules:

* split sum must equal transaction amount when the parent transaction is approved
* all categorized spending flows through splits (on approved transactions)
* transfers carry no allocations (the split-sum and approved-requires-allocation rules are not enforced on transactions with `transfer_account_id` set)

---

CATEGORY GROUPS

Fields:

* id
* name
* budget_mode

  * 'category'
  * 'group'
* is_pinned

Purpose:

Groups organize categories and optionally support pooled budgeting behavior.

---

CATEGORIES

Fields:

* id
* name
* group_id
* role (nullable)

  * `ready_to_assign` — system pool for unallocated cash; exactly one row in the database
  * `sinking_fund` — shared pool that funds `sinking` targets; at most one row per plan; its target is derived, never stored (see TARGETS)
* is_pinned
* is_hidden

Rules:

* the Ready to Assign category is created at schema seed; users categorize **inflows** here (positive splits)
* assigning money to spending categories draws from Ready to Assign (see READY TO ASSIGN)
* do not use account `balance_cents` for Ready to Assign math

---

SPENDING PLAN WIZARD

A guided flow (Plan page's 3-dot menu → "Spending plan") for editing the whole plan at once: income sources plus a spreadsheet-style list of expense lines, each a category (or group-budgeted group) and its target (`app/(app)/budget/actions.ts` `applySpendingPlan`, `components/budget/spending-plan-wizard.tsx`). Named "Spending Plan," not "plan," to avoid colliding with the `plans` workspace concept.

* It opens pre-loaded with every existing target except one-time `by_date` ones. Removing a pre-loaded line (or pointing it at a different category) deletes that target on save; one-time `by_date` targets are left alone but still count toward the totals.
* **Income sources** (`income_sources` table, plan-scoped) are a simple name + monthly amount, purely informational — summed for a "planned income" figure. They are never categorized and never feed Ready to Assign; RTA stays derived from ledger inflows only.
* **Available** = planned income − the steady monthly cost of every target (`targetMonthlyCostCents`): the full amount for `set_aside`/`fill_up_to`, amount ÷ cycle for recurring `by_date` and `sinking`, and amount ÷ months remaining for a one-time `by_date`. Unlike Assign by Targets' `targetNeedCents`, it ignores what's already been assigned this month.
* Recurring lines (every 3, 6 or 12 months — `TARGET_REPEAT_INTERVALS`, the one place to add another cadence) are either **saved up by a due date** (a recurring `by_date` target, e.g. Christmas) or funded through the **sinking fund** (a `sinking` target, e.g. Vacations — see TARGETS).
* Credit-card payment categories and system categories (Ready to Assign, the Sinking Fund) are never offered in the picker. A group-budgeted group's individual categories aren't either — only the group itself, since it's the funding unit (see GROUP BUDGETING RULES).

---

BUDGET MOVES

The source of truth for assignments: an append-only log of every movement of
assigned money between funding units (a category, a group-budgeted group, or
Ready to Assign). Powers the YNAB-style "Moves" history.

Fields:

* id
* plan_id (set and verified by the insert trigger from the two units)
* month (budget month affected, first day of month)
* moved_at (when the move happened; shown in the history — differs from `month` when assigning to another month)
* from_category_id / from_group_id (exactly one set)
* to_category_id / to_group_id (exactly one set)
* amount_cents (> 0)
* source ('user' | 'cover' | 'import' | 'backfill')
* created_by (stamped from `auth.uid()`; null = system; no FK so history survives user deletion)

Rules:

* Ready to Assign is stored as the plan's RTA category id, never null
* both sides must belong to the same plan, and must differ
* append-only: no updates or deletes; corrections are new moves
* write through `ledger_set_assigned` (absolute amounts → a move with RTA for the difference) or `ledger_move_money` (explicit pairs, e.g. cover overspending)

---

MONTHLY BUDGETS (view)

`monthly_budgets` is a view over BUDGET MOVES with the columns readers have
always used: month, category_id, group_id, assigned_cents. Each move counts
+amount for its destination and −amount for its source, summed per (month,
unit). Ready to Assign's own side is excluded — RTA is computed separately (see
READY TO ASSIGN). `category_monthly_assigned` / `group_monthly_assigned` read
from it. The pre-moves table is kept frozen as `monthly_budgets_legacy` until it
is dropped.

---

TARGETS

Fields:

* id
* category_id (nullable)
* group_id (nullable)
* type

  * 'fill_up_to'
  * 'set_aside'
  * 'by_date'
  * 'sinking'
* amount_cents
* target_date (nullable; required for `by_date`, always null for `sinking`)
* repeat_interval_months (nullable; `by_date` may recur every N months, `sinking` always has one)

Rules:

* a recurring `by_date` target's due date rolls forward to its next occurrence on read (`effectiveTargetDate`), never written back — no background job
* a `sinking` target means "need `amount_cents` at the start of every cycle." It asks nothing of Ready to Assign itself; instead the shared `sinking_fund` category accrues its share. That category's target is **derived, never stored**: a monthly `set_aside` of Σ ceil(amount ÷ interval) over every sinking target (`withDerivedSinkingFundTarget`), so editing or removing a sinking target updates it automatically. Moving money from the Sinking Fund (or Ready to Assign) into the category is always manual. The Sinking Fund is created lazily (in its own group) the first time a sinking target is saved, and its target can't be edited directly

---

BUDGET SETTINGS

Fields:

* id
* monthly_income_cents (optional planning hint; income still flows through ledger splits into Ready to Assign)

---

## CORE CALCULATIONS

CATEGORY ACTIVITY

Definition:

Sum of transaction split amounts for a category during a month.

---

GROUP ACTIVITY

Definition:

Sum of category activity within the group.

---

AVAILABLE

Definition:

available = last_month_available + assigned + activity

Important:

* activity is negative for spending
* rollover is automatic via previous month availability

---

READY TO ASSIGN

Ready to Assign is a **system category** (`role = ready_to_assign`), not a value derived from bank balances.

**Inflows:** categorize positive transactions (paycheck, refunds, etc.) with splits to Ready to Assign. That increases Ready to Assign **activity** for the month.

**Assignments:** assigning money to a category records a budget move from Ready to Assign to that category (and un-assigning records the reverse). The category's assigned total rises by the amount; Ready to Assign falls by the same amount because it is computed from the spending categories' assigned totals, not from its own row in `monthly_budgets` (the view excludes it).

**Available** (computed, same as any category):

ready_to_assign_available = last_month_available + assigned + activity

Important:

* represents unallocated cash in the **budget**, separate from the **ledger**
* account `balance_cents` is only for reconciliation against the bank; never use it in Ready to Assign or category available math
* spending categories consume cash via splits; assigning moves dollars from Ready to Assign into category envelopes
* **credit-card opening balances are excluded from the total.** Their opening-balance split lands in Ready to Assign for register parity, but the computed RTA backs them out (the negative debt is not assignable cash). The debt instead surfaces as an underfunded credit-card payment category. The same exclusion must be applied everywhere RTA is computed (currently the budget page and the home page)

**The RTA total and its breakdown (YNAB parity).** For the viewed month, `computeRtaBreakdown` (`lib/budget/compute.ts`) is the single source of truth for the RTA total. It buckets the inputs by when they land relative to the viewed month and applies two YNAB rules:

* **Cash overspending** is charged forward per the cash-overspend rule (see CATEGORY AVAILABLE / `computeAvailableWithOverspend`). Only the **previous** month's cash overspend shows as its own breakdown line; overspend charged earlier is already absorbed into the money carried over, so it is folded into the "left over from prior month" line.
* **Future assignments** (money assigned to months after the viewed one) reduce the viewed month's RTA only down to `$0`: the committed-ahead total is capped at the cash available before future assignments, because any excess is funded by income arriving in those future months, not by cash on hand now. So future over-assignment never drags the viewed month negative — only over-assigning the current month (or uncovered cash overspending) can. Future-dated inflows do **not** count toward an earlier month's RTA.

The breakdown lines (`leftover + inflow − assigned this month − previous-month cash overspend − assigned in future`) always sum to the RTA total, and are surfaced to the user in the Ready to Assign breakdown popover.

Because assignments in **all** later months feed the "assigned in future" line (only inflows are bounded to the viewed month), RTA reports the same global figure on every month — historical, current, and future — exactly as YNAB does. There is no per-month "snapshot"; the viewed month only changes how the same total is decomposed.

---

## GROUP BUDGETING RULES

If a category group uses:

budget_mode = 'group'

Then:

* assignments happen only at the group level
* individual categories cannot receive assignments
* spending is still categorized normally
* available balance is enforced at the group level

If a group uses:

budget_mode = 'category'

Then:

* categories are budgeted individually

---

## MOVE MONEY

General-purpose move of assigned money between any two funding units (a
category in a category-budgeted group, or a group-budgeted group) or Ready to
Assign, for the month in view. Reached from the row's menu (long press, or
right-click on desktop: "Move money"), which opens with that unit as the source; a swap button flips it to
the destination.

* the amount may exceed the source's available balance (the dialog warns that
  it will go negative) — same as editing assigned amounts directly
* recorded as one budget move (`source = 'user'`) via `ledger_move_money`
  (`components/budget/move-money-popup.tsx`, `lib/budget/move-money.ts`)

**View moves** (same row menu, `/budget/moves?category=|group=&month=`) lists
every move into or out of that funding unit for the viewed budget month, or all
months, grouped by the day it happened in the viewer's time zone and signed
relative to the unit (+ in, − out). Backfilled moves, whose real dates are
unknown, are grouped under "Before move history" (`lib/budget/moves-history.ts`,
`app/api/budget-moves/route.ts`).

---

## COVER OVERSPENDING

YNAB-style action for fixing a negative available balance on a funding unit
(a category in a category-budgeted group, or a whole group in a
group-budgeted group — see GROUP BUDGETING RULES). Reachable by clicking the
red available amount.

* the user picks any number of other funded funding units (available > 0),
  or Ready to Assign, as sources
* each source's contribution is independently editable — a user may take
  less than a source's full available balance, leaving the rest there
* the total pulled cannot exceed the overspent amount or any source's own
  available balance; partial covers (leaving some overspend uncovered) are
  allowed
* implemented as one budget move per source into the overspent unit for the
  viewed month (`source = 'cover'`), written atomically via
  `ledger_move_money` — including a move from Ready to Assign when it is a
  source (see BUDGET MOVES)
* this is a different mechanic from a credit-card payment category's
  "assign to cover" (see CREDIT CARD LOGIC), which only ever pulls from
  Ready to Assign for that one category

---

## TRANSFERS

A transfer is a movement of money between two of the user's own accounts. It is
created via the `ledger_create_transfer` SQL function, which writes **both legs
atomically**: an outflow on the source account and a matching inflow on the
destination, each pointing at the other account via `transfer_account_id`. Never
create a transfer by setting `transfer_account_id` on a single row — the mirror
leg will be missing.

Rules:

* a transfer between two **on-budget** accounts (e.g. checking → savings, or
  checking → credit card) has both legs created **already approved** with
  **no allocations** — it is not income or spending, so it is never
  categorized, and has **zero budget effect** (the same budgeted dollars
  simply move accounts). A transfer **to a credit card** is a card payment:
  it drains that card's payment category (see CREDIT CARD LOGIC).
* a transfer where **either side is a tracking account** (asset/liability) is
  mixed: the leg on the **tracking** account is still auto-approved with no
  allocation (tracking accounts are never categorized), but the leg on the
  **on-budget** account is left **pending approval** instead — cash crossing
  the budget boundary is economically like a purchase or income and needs a
  category. This reuses the existing "categorize then approve" flow (the home
  page pending-approval list, which opens the transaction editor) rather than
  any new UI; once approved, that leg's allocation flows into
  `category_monthly_activity` exactly like a normal transaction.
* a transfer between two tracking accounts has **zero budget effect** — same
  as on-budget ↔ on-budget, both legs auto-approved with no allocation.
* because on-budget ↔ on-budget and tracking ↔ tracking transfers are
  uncategorized, they are exempt from the approved-requires-allocation and
  split-sum constraints (see TRANSACTIONS); this exemption is keyed off
  `on_budget` per account inside `ledger_create_transfer`, not just "is this
  a transfer"

**Linking an existing transaction as a transfer.** When the user converts an
existing single-sided transaction into a transfer (the `transaction-form`
"Transfer" direction on an edit), Plaid may have already synced the other
leg independently — most commonly a credit card payment, reported as an
ordinary outflow on the checking account and an ordinary inflow on the card,
with no notion of the Crest transfer linkage. Recreating both legs from
scratch via `ledger_create_transfer` would leave that existing row behind as
an unlinked duplicate, double-counting the payment. `saveTransaction`
(app/(app)/transactions/actions.ts) guards against this: before recreating,
it looks in the destination account for an existing unlinked transaction
with the exact opposite amount and a nearby date (`selectTransferLinkMatch`,
lib/ledger/transfer-match.ts) and, if found, adopts it via the
`ledger_link_transfer` SQL function instead of creating a new counterpart.
That function applies the being-converted row's edited amount/date/memo/
cleared state, clears any allocations either leg had picked up, and sets
`transfer_account_id` on both rows atomically. Falls back to the normal
delete + `ledger_create_transfer` path when no match exists. Like
`ledger_create_transfer`, it's on_budget-aware: linking a mixed on-budget ↔
tracking pair leaves the on-budget leg pending instead of auto-approving it,
same rule as above — except a leg that was already approved before the link
keeps that approval rather than being reset to pending.

---

## CREDIT CARD LOGIC

Each credit account has a dedicated payment category. Credit card handling mirrors
YNAB-style reserved-cash behavior. Payment-category activity is **derived** from
the card's register (it is never categorized to the payment category directly —
that would double-count). For a viewed month it decomposes as:

```
total activity = funded spending − payments − returns
```

and the budget screen exposes this as a popover breakdown (Spending, Returns,
Funded Spending, Payments & Returns, Totals).

**Funded spending.** When a credit-card purchase occurs (an approved, categorized,
non-transfer outflow on the card), the spending category's activity decreases, and
the payment category is filled with only the **funded** portion of the spend — the
amount the spending category actually had money to cover. Concretely, for a
spending category in a month, the funds available before its credit purchases =
its rolled-forward available + that month's credit outflow (adding the outflow back
recovers the pre-purchase balance, which already reflects assignments, cash
spending, and returns). The funded amount is capped at those funds; any excess is
**uncovered debt** and surfaces as an underfunded payment category. Funded spending
is computed per funding unit per month and attributed across cards in proportion
to each card's share of that unit's outflow. The funding unit is the spending
category itself, except for categories in a **group-budgeted** group, whose funds
live on the group — there the cap is assessed against the group's available, not
the (always-negative) per-category available.

This means an underfunded spending category no longer reserves cash it doesn't
have: the payment category's available reflects what's truly covered, not the raw
card balance.

**Returns.** A return/refund (a categorized, non-transfer **inflow** on the card)
reduces the card's debt, so it drains the payment category by the return amount
(grouped with payments as "Payments & Returns"). The refund also flows back into
its spending category's available via the allocation, as usual.

**Payments & transfers.** Any transfer on the card moves its balance, so it moves
the payment obligation, and the effect is derived from the transfer itself (no
spending category, never categorized). A transfer **inflow** (a payment to the
card) reduces debt and **drains** the payment category by the amount. A transfer
**outflow** (money moved off the card — withdrawing a credit balance, or a cash
advance to another account) increases debt and **fills** the payment category by
the amount, symmetric to a payment. The signed transfer amount captures both;
dropping the outflow leg strands the payment category negative — e.g. a refund
(drain) followed by transferring that credit balance out (fill) nets to $0 owed,
and both legs are required to land the payment category back at $0.

**Opening balance (pre-existing debt).** The card's negative opening balance is
**not** injected into the payment category and is **excluded from the Ready to
Assign total** (see READY TO ASSIGN). It is part of the card's register balance
(real debt) but unfunded, so the payment category shows $0 available against a
negative register balance until the user assigns real dollars.

**Register balance vs. funded available.** The card's register balance is the
**real amount owed**: it sums *all* transactions (approved or not) plus the
opening balance. Funded spending, by contrast, counts only approved, categorized,
covered purchases (the budget read-models are approved-only). So an
unapproved/uncategorized purchase — which can't be approved without an allocation —
adds to the debt and to gross **Spending** in the breakdown, but contributes
**no** funded spending, leaving the payment category underfunded until it is
approved and covered.

**Underfunded indicator.** The payment category is flagged **underfunded (amber)**
when its (funded) available is less than the card's debt. The shortfall —
`max(0, abs(cardRegisterBalance) − available)` when there is debt — is computed by
`paymentShortfallCents` (the single source of truth for both the amber state and
the one-click "assign to cover" amount). It is non-zero for uncovered spending,
unapproved/uncategorized purchases, and unassigned opening debt alike.

---

## RECONCILIATION

When a user initiates account reconciliation:
* Show the **register cleared balance** — sum(amount_cents) of all **cleared** transactions (`cleared_at` set), including the opening-balance line — and ask the user whether it matches their bank
* If it looks right, snap `balance_cents` to the register cleared balance and set `reconciled_at = now()` for all cleared, unreconciled transactions (`reconcileWithRegisterBalance`). For unlinked accounts `balance_cents` only moves here, so this snap is what keeps the stored bank balance current.
* If it's off, the user enters the actual cleared balance (signed — credit-card debt is negative). Write a single cleared, approved balance-adjustment line for the difference, **assigned to Ready to Assign**, then snap `balance_cents` to the actual amount and reconcile (`reconcileWithAdjustment`).
* Pending register lines are excluded from reconciliation but included in the computed approximate available balance

---

## REPORTS

A spending-breakdown view (`/reports`), built entirely on read models that already exist for budgeting — no new derived/stored money values.

* **Periods**: this month, last 3 months, last 6 months, this year, any prior calendar year with spending, all time. Ranges are `[from, to)` in budget-month terms (`lib/reports/period.ts`); the prior-years list comes from distinct years present in `category_monthly_activity`.
* **Data source**: `category_monthly_activity` (the same approved-ledger read model the budget screen uses) summed across the period's months per category. A category is "spending" for the period only if its net activity is negative (pure refunds/credits net to zero and are excluded). This keeps report totals consistent with budget activity by construction.
* **Category/group selection**: multi-select over categories, with a group checkbox as a bulk select/deselect-all for its member categories (tri-state: unchecked / indeterminate / checked). No selection means "all categories."
* **Saved views** ("Fixed Bills", "Fun Money", etc.) are a **client-only convenience** — stored in `localStorage`, never the database. They're just a named category-id list; nothing about them needs to sync across devices or survive a lost browser profile.
* **Chart**: a donut of the selected categories' spend, sharing color-by-rank with the list below it. No separate legend — the category list under the chart *is* the legend, so nothing duplicates the name/amount/percent it already shows. Beyond 7 slices the tail is folded into one "Other" slice in the chart only; the list below always shows every category individually.
* **Drill-down**: clicking a category opens a slide-over panel listing its transactions for the active period, reusing the account register's exact "Select" → checkbox rows → sticky bulk-action-bar interaction (same `BulkActionsBar`, same categorize/move/approve/delete actions) rather than a new selection pattern.

---

## TRANSACTION IMPORT + PLAID

Plaid is in scope for MVP.

Requirements:

* users can link bank accounts
* linked accounts can sync transactions
* imported transactions support approval workflows
* duplicate detection should rely on imported_id when available
* manual transactions remain fully supported
* users can create accounts that are not linked to Plaid

Do not tightly couple the ledger model to Plaid-specific behavior.

Plaid should act as an import/sync layer, not the core transaction system.

---

## AUTO-CATEGORIZATION

Incoming transactions get a **suggested** category; the user still approves every one.

Rules:

* A suggestion is an ordinary single, full-amount allocation on a still-**unapproved** transaction, tagged with `transactions.category_source` (`rule` | `history`, plus `category_rule_id` for rules). Nothing in auto-categorization ever sets `approved_at`, and approval keeps whatever allocations the row already has — so approving a suggested row approves the suggestion. Budget math is unaffected until approval (read models count approved rows only).
* `category_source` is non-null only while the row's categories are exactly what was suggested. `ledger_replace_allocations` / `ledger_update_amount_and_allocations` clear it whenever a caller changes the **set of categories** (an amount-only edit keeps it), and linking the row into a transfer clears it.
* Only rows still open to a suggestion are touched: unapproved, on-budget, not a transfer, with a payee, and either uncategorized or holding an untouched suggestion (which is recomputed, so a new rule replaces a history guess). A category the user picked is never overwritten.
* Matching uses `transactions.payee_key`, a generated column: `normalize_payee(payee)` lowercases and strips store numbers (`#117`, `store 1234`, trailing digit words) and punctuation. Plaid's `merchant_name` is usually clean already; this covers the raw-name fallback and manual entries.
* **Rules** (`category_rules`, per plan) match `exact` (equal key) or `contains` (substring, at least 3 characters), by direction (outflow / inflow), optionally an absolute amount range (`min_cents` and `max_cents`, both inclusive) and an account. `match_text` is stored normalized. Rules are checked in `priority` order (lowest first) and **the first match wins**; the user sets the order by dragging on the rules page (`category_rules_reorder`). New rules go to the top. Rules whose category is hidden are skipped (kept, not deleted).
* **Payee history**, for rows no rule matched: among the payee's last 10 approved, non-transfer transactions of the same direction in the plan, the category used by at least 70% of them. A split counts as a vote for no category. One prior transaction is enough.
* Never suggested: hidden categories, the Sinking Fund, credit-card payment categories; Ready to Assign only for inflows.
* `ledger_apply_category_suggestions(uuid[])` runs the whole batch in one statement. Plaid sync calls it once per sync with every row it wrote; plan scoping is explicit because the webhook runs as `service_role`.

UI:

* Pending rows with a suggestion show a "Suggested" tag (home Needs Approval, All Transactions, account registers); the edit form says where the suggestion came from and that saving approves it.
* **Make this a rule?** After an edit saves a single category that differs from what the row had (nothing, an overridden suggestion, or an earlier pick), and no rule already targets that payee (`ruleTargetsPayee`, ignoring amount/account conditions), `saveTransaction` returns a `rulePrompt`. A banner offers *Create rule* (exact match on the payee key), *Customize…* (opens the rule editor prefilled) or ✕, which stops offering it **for that payee on this device** (localStorage). It auto-hides after a few seconds without being remembered. Bulk actions never prompt.
* **Rules page** (`/rules`, from the Plan page's ⋯ menu): list in match order (`payee → category`, conditions underneath as "$X or less" / "$X or more" / "$X to $Y"), drag to reorder, create, edit, delete. The editor shows a live preview (`category_rule_preview`: how many past transactions match, with sample payees). Saving a rule re-runs suggestions over the plan's pending transactions; deleting one leaves suggestions it already made. Rules for a hidden category are flagged as paused.

---

## TRANSACTION API

Implement:

upsert_transaction(input)

Behavior:

* if imported_id already exists:

  * update existing transaction
* otherwise:

  * create new transaction

On update:

* replace all existing splits

Validation:

* split totals must equal transaction amount (if provided)

---

## UI / UX DIRECTION

GENERAL

* mobile-first
* responsive desktop layout
* prioritize fast budgeting workflows
* minimize visual clutter
* avoid over-designed fintech aesthetics
* optimize for repeated daily use

Preferred UI style:

* clean
* dense but readable
* highly scannable
* spreadsheet-inspired budgeting interactions

---

HOME PAGE

Purpose:
daily financial overview

Show:

* transactions requiring approval
* overspent categories/groups
* pinned category groups
* pinned categories
* remaining available amounts for current month
* quick navigation into budgeting workflow

Mobile layout:

* stacked cards/list sections

Desktop layout:

* two-column dashboard is acceptable

---

BUDGET SCREEN

Purpose:
primary budgeting workflow

Show:

* category groups
* categories
* assigned
* activity
* available

Capabilities:

* edit assignments inline
* collapse/expand groups
* display ready-to-assign prominently
* visually distinguish overspending
* cover overspending from another funded category/group, or Ready to Assign
  (see COVER OVERSPENDING), by clicking the negative available amount
* support group-budgeted and category-budgeted modes

Mobile:

* prioritize vertical scrolling
* compact rows
* sticky month summary/header if useful

Desktop:

* table/grid layout acceptable

---

ACCOUNTS PAGE

Purpose:
ledger/account management

Show:

* all connected accounts
* all manual accounts
* balances
* account type
* linked/manual status
* accounts grouped by Cash / Credit / Tracking (asset + liability)

Capabilities:

* reconcile accounts
* manually add accounts
* eventually manage linked connections

---

## GUARDRAILS

Never:

* store derived available values
* mix budget and ledger responsibilities
* bypass split validation
* bypass group/category assignment rules
* use floating point currency math

Always:

* compute financial state from source data
* preserve accounting integrity
* favor explicitness over hidden behavior

---

## IMPLEMENTATION PRIORITIES

Suggested order:

1. database schema + constraints
2. ledger engine
3. transaction split enforcement
4. budgeting calculations
5. budget UI
6. credit card handling
7. transaction approval workflow
8. Plaid integration
9. reconciliation workflows
10. polish + responsiveness

---

## SUCCESS CRITERIA

The MVP is successful if:

* balances remain mathematically correct
* budget calculations are trustworthy
* users can fully manage finances manually
* linked accounts sync reliably
* budgeting workflows are fast on mobile
* the architecture can support future expansion without major rewrites
