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
* **opening balance** at link/create: one cleared, approved transaction (`imported_id = crest:opening_balance`, payee “Starting Balance”) with a split to Ready to Assign. This holds for **all** account types, including credit cards (whose opening balance is negative debt) — but credit-card opening balances are **excluded from the Ready to Assign total** so pre-existing debt does not reduce assignable cash (see READY TO ASSIGN and CREDIT CARD LOGIC)
* **working balance** (the default account figure everywhere in the UI, computed): sum(amount_cents) of **all** register lines, cleared and uncleared. This is the register's own truth and updates the instant a transaction is entered, so it never lags Plaid sync or reconciliation the way `balance_cents` does. On the account register it can be expanded into its cleared / uncleared split. `balance_cents` (the bank statement balance) is **not shown outside the reconcile flow**.
* **register cleared balance** (computed, for reconcile check + the working-balance split): sum(cleared transaction amounts), including the opening-balance line
* **approximate available balance** (legacy computed helper, no longer surfaced in the UI): `balance_cents` + sum(amount_cents) of uncleared register lines (`cleared_at IS NULL`)
* manual accounts are supported for testing (`createAccount` with `openingBalanceCents` seeds `balance_cents` and the opening transaction)

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
* is_pinned
* is_hidden

Rules:

* the Ready to Assign category is created at schema seed; users categorize **inflows** here (positive splits)
* assigning money to spending categories draws from Ready to Assign (see READY TO ASSIGN)
* do not use account `balance_cents` for Ready to Assign math

---

MONTHLY BUDGETS

Fields:

* id
* month
* category_id (nullable)
* group_id (nullable)
* assigned_cents

Rules:

* exactly one of category_id or group_id must be set
* month must be first day of month

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
* amount_cents
* target_date (nullable)

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

**Assignments:** when the user assigns money to another category, increase that category’s `assigned_cents` and decrease Ready to Assign by the same amount (negative `assigned_cents` on the Ready to Assign category for that month, or an equivalent transfer in application code).

**Available** (computed, same as any category):

ready_to_assign_available = last_month_available + assigned + activity

Important:

* represents unallocated cash in the **budget**, separate from the **ledger**
* account `balance_cents` is only for reconciliation against the bank; never use it in Ready to Assign or category available math
* spending categories consume cash via splits; assigning moves dollars from Ready to Assign into category envelopes
* **credit-card opening balances are excluded from the total.** Their opening-balance split lands in Ready to Assign for register parity, but the computed RTA backs them out (the negative debt is not assignable cash). The debt instead surfaces as an underfunded credit-card payment category. The same exclusion must be applied everywhere RTA is computed (currently the budget page and the home page)

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

## TRANSFERS

A transfer is a movement of money between two of the user's own accounts. It is
created via the `ledger_create_transfer` SQL function, which writes **both legs
atomically**: an outflow on the source account and a matching inflow on the
destination, each pointing at the other account via `transfer_account_id`. Never
create a transfer by setting `transfer_account_id` on a single row — the mirror
leg will be missing.

Rules:

* both legs are created **already approved** and carry **no allocations** — a
  transfer is not income or spending, so it is never categorized
* a transfer between two on-budget cash accounts (e.g. checking → savings) has
  **zero budget effect** — the same budgeted dollars simply move accounts
* a transfer **to a credit card** is a card payment: it drains that card's
  payment category (see CREDIT CARD LOGIC)
* because transfers are uncategorized, they are exempt from the
  approved-requires-allocation and split-sum constraints (see TRANSACTIONS)
* off-budget / tracking accounts are not yet supported; if added, transfers to
  them would be categorized like spending and this section must be revisited

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

**Payments.** A payment transfer to a credit card (a transfer inflow on the card)
drains the payment category by the payment amount. No spending category is
involved and the transfer is not categorized — the drain is derived from the
transfer itself.

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
