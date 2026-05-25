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
* balance_cents
* payment_category_id (nullable, required for credit accounts)
* is_linked
* plaid_item_id (nullable)
* plaid_account_id (nullable)
* is_active
* created_at

Rules:

* credit accounts require a payment category
* linked accounts may sync transactions automatically
* manual accounts are fully supported

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
* is_pinned
* is_hidden

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
* monthly_income_cents

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

Definition:

ready_to_assign = sum(all account balances) - sum(all assigned budget amounts through current month)

Important:

* this represents unallocated cash
* budget assignments reduce ready-to-assign
* transactions themselves do NOT directly affect ready-to-assign

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

## CREDIT CARD LOGIC

Each credit account has a dedicated payment category.

When a credit card purchase occurs:

* spending category activity decreases
* corresponding payment category available increases by abs(amount)

When a payment transfer to a credit card occurs:

* payment category available decreases
* no spending category is involved

Credit card handling should mirror YNAB-style reserved cash behavior.

---

## RECONCILIATION

When a user initiates an account reconciliation: 
* If the cleared account balances equals the sum of all the cleared transactions for that account, set reconciled_at = now() for all cleared transactions
* Otherwise, tell the user what the difference is and explain to them how they can fix it 

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
