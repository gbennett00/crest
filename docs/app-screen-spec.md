# Budget App — Screen Spec

> Derived from screenshots. Screens are grouped by parent view.

---

## 1. Home Screen

### 1a. Home — Top Section (above the fold)

- **Page title**: "[User]'s Plan" (large, bold, top-left)
- **Action card** ("Lookin' good, [User]"):
  - Subtitle: "Just a few things to do"
  - Row 1: Numbered badge (e.g. `3`) + label "New transactions" + `Review` button (pill, purple)
  - Row 2: Dollar amount badge (green, e.g. `$647.13`) + label "Ready to assign" + `Assign` button (pill, purple)
- **Top-right**: `...` overflow menu button (green circle)

### 1b. Home — Pinned Section

- Section header: "Pinned" with collapse chevron (▾) + `Edit` button (pill, right-aligned)
- Each pinned item is a row with:
  - Emoji icon (left)
  - Label (e.g. "Groceries", "Dating", "Dream vacation")
  - Dollar amount badge (right, green pill)
  - Some items show a `ᶻᶻ` snooze indicator next to the amount
- Pinned items visible across screenshots:
  - BoA Atmos – 2347 · `$2,316.56`
  - 🛒 Groceries · `$59.20` _(snoozed)_
  - 💝 Dating · `$49.75`
  - 🎿 Garrett's Allowance · `$140.67`
  - 💅 Zoie's Allowance · `$579.15`
  - ✈️ Visiting Family · `$470.75`
  - 🏝️ Dream vacation · `$2,424.33`

### 1c. Home — Lower Sections

- **Current Goal** — collapsed section (▶ chevron, tappable to expand)
- **May Summary** — expanded section showing 4 stat tiles in a 2×2 grid:
  - 🎯 Total Targets · `$5,404.78` (tappable, `>` arrow)
  - 🥧 Underfunded · `$0.00` (tappable, `>` arrow)
  - 🏠 Assigned · `$8,192.63` (tappable, `>` arrow)
  - 💵 Spent · `$7,999.32` (tappable, `>` arrow)
- **Assigned in Future Months** — collapsed section (▶ chevron)
- **For You** — collapsed section (▶ chevron)
- **Floating `+` button** (bottom-right) — opens Add Transaction

### 1d. Home — Floating "+ Transaction" Bar

- Appears as a pill/tab bar overlay at bottom of screen
- Label: `+ Transaction`
- Tapping opens the Add Transaction modal (see Section 4)

---

## 2. Plan Screen

### 2a. Plan — Header & Top Bar

- **Month selector**: "May 2026 ▾" (centered, tappable dropdown)
- **Left icons**: pencil/edit icon + filter/sort icon (pill button, top-left)
- **Top-right**: `...` overflow menu
- **Ready to Assign banner**: full-width green pill showing dollar amount (e.g. `$647.13`) + label "Ready to Assign ›" — tappable

### 2b. Plan — Credit Card Payments Group

- Section header: "Credit Card Payments" with collapse chevron (▾)
- Right-side column header: "Available for Payment"
- Each row:
  - Account name (e.g. "Chase – 5060")
  - Amount badge (green if funded, gray if `$0.00`, yellow/orange if partially funded)
  - Accounts shown:
    - Chase – 5060 · `$454.02` (green)
    - Quicksilver – 9536 · `$0.00` (gray)
    - Citi – 7199 · `$0.00` (gray)
    - BoA Atmos – 2347 · `$2,316.56` (green)
    - Venture – 2562 · `$1,026.86` (yellow/orange)

### 2c. Plan — Needs Group

- Section header: "Needs" with collapse chevron (▾)
- Right-side column headers: "Available to Spend"
- Each category row shows:
  - Emoji icon + category name
  - Assigned amount 
  - Available amount (in a pill: green if > 0, gray if 0)
- Categories visible:
  - 🛒 Groceries · `$59.20` — Spent $508.04 of $567.24
  - 🚗 Transportation · `$0.00` — Fully Spent
  - 🧴 Personal care · `$0.00` — Fully Spent
  - 👖 Clothing · `$0.00` (partially visible)

### 2d. Plan — Wants Group

- Section header: "Wants" with collapse chevron (▾)
- Column headers: "Assigned" + "Available" (two right-aligned columns)
- Each row shows: emoji + name + assigned amount + available badge
- Categories visible:
  - 🎿 Garrett's Allowance · Assigned `$93.26` · Available `$140.67`
  - 💅 Zoie's Allowance · Assigned `$200.00` · Available `$579.15`

### 2e. Plan — Bills Group

- Section header: "Bills" with collapse chevron (▾)
- Column headers: "Assigned" + "Available"
- Group totals shown in header: Assigned `$1,780.06` · Available `$366.68`
- Categories visible:
  - 🧾 Reimbursable · `$127.41` · `$0.00` (gray)
  - 🏠 Rent · `$1,450.00` · `$0.00` (gray)
  - 💻 TV, phone and int… · `$107.00` · `$0.00` (gray)
  - 📄 Insurance · `$91.67` · `$366.68` (green)
  - 📅 Other subscriptions · `$3.98` · `$0.00` (gray)

### 2f. Plan — Savings Group

- Section header: "Savings" with collapse chevron (▾)
- Column headers: "Assigned" + "Available"
- Group totals: Assigned `$3,486.57` · Available `$56,164.18`
- Categories visible:
  - 🛋️ Furniture · `$2,628.09` · `$4,000.00` (green)
  - 🍼 Baby · `$0.00` · `$1,X` (green, partially cut off)
  - 🏠 New home · `$858.48` · `$25,962.75` (green)

---

## 3. Category Detail Screen (e.g. Rent)

- **Header**: emoji + category name (e.g. "🏠 Rent") + blue checkmark button (top-right, confirms/saves)
- **Balance section**:
  - "From [Prior Month]" · amount (e.g. `$0.00`)
  - "Assigned for [Month]" · amount + `>` arrow (tappable)
  - "Activity in [Month]" · negative amount + `>` arrow (tappable, shows transactions)
  - "Available" · amount badge + `>` arrow (tappable)
- **Target section**:
  - Large circular checkmark icon (green = target met)
  - Banner label: "You've met your target!" (green pill)
  - Target description: "Set Aside Another $X Each Month / By the [date] of the Month"
  - "Amount to Assign This Month" · `$X`
  - "Assigned So Far" · `$X`
  - "To Go" · `$0.00`
  - `Edit Target` button (bottom, pill)
  - `ᶻᶻ Snooze for this month` toggle (bottom)

---

## 4. Add Transaction Modal

- **Header**: "Add Transaction" (centered) + `✕` close button (top-left)
- **Type toggle**: segmented control — `— Outflow` (selected by default) | `+ Inflow`
- **Amount display**: large centered dollar amount (red for outflow, e.g. `–$0.00`)
- **Form fields** (each row has icon + label + `>` arrow, tappable):
  - 🔄 Choose Payee
  - 🏠 Choose Category
  - 🏛️ Account · pre-filled with last used (e.g. "Venture – 2562")
  - 📅 Date · pre-filled with today (e.g. "May 31, 2026")
- **Optional fields**:
  - 🖼️ Photo (tappable)
  - 📝 "Enter a memo…" (text input)
- **Additional settings**:
  - 🚩 Flag · "None" (tappable, opens flag picker)
  - © Cleared · toggle switch (off by default)
  - 🔁 Repeat · "Never" + `>` arrow (tappable)
- **Save button**: large blue pill `✓ Save` — floating bottom-right, always visible

---

## 5. Accounts Screen

- **Header**: "Accounts" (large, bold, top-left)
- **Top-right**: `+` button (add account) + `...` overflow menu (combined pill)
- **Starred group**:
  - Header: "Starred" · total balance (e.g. `–$3,355.47`)
  - Each row: bank logo icon + account name + balance + `>` arrow
  - Accounts: BoA Atmos – 2347 · `–$2,316.56`, Venture – 2562 · `–$1,038.91`
  - Unread/sync indicator dot (blue) shown on Venture
- **Cash group**:
  - Header: "Cash" · total `$73,532.64`
  - Crew – 6169 · `$6,041.41`
  - Wells Fargo Checking – 5256 · `$5,424.92`
  - Barclays Savings – 1691 · `$56,581.31`
  - BoA Savings – 4425 · `$5,485.00`
- **Credit group**:
  - Header: "Credit" · total `–$3,809.49`
  - Chase – 5060 · `–$454.02` (partially visible, more below fold)
  - Citi – 7199 · `$0.00` (partially visible)

---

## 6. Account Detail Screen (e.g. Venture – 2562)

### 6a. Account Detail — Header & Balance

- **Back arrow** (top-left) + Account name "Venture –…" + `Select` button + 🔍 search icon + `...` overflow
- **"Linked"** label beneath account name (indicates bank sync)
- **Working Balance**: `–$1,038.91` (large, centered)
  - Tapping the balance area toggles between:
    - Working Balance only
    - Working Balance + Cleared `–$857.93` + Uncleared `–$180.98`
- **"Record Payment" button**: full-width blue pill (for credit card accounts)
- **"Show X uncleared transactions"** banner: tappable row with `>` arrow

### 6b. Account Detail — Additional Sections

- **Scheduled** — collapsed section (▶ chevron) visible above the transaction list on cash accounts; tappable to expand upcoming/recurring transactions

### 6c. Account Detail — Transaction List

- Transactions grouped by date (date shown as section header)
- Each transaction row:
  - Payee name (bold)
  - Amount (negative = outflow in white/default; positive = inflow in green)
  - Cleared indicator: 🟢 filled circle = cleared; ⚪ outline circle = uncleared; 🔒 lock = reconciled
  - Category tag badge beneath payee name (pill with emoji + category name)
  - Memo shown as sub-label if present (e.g. "Amazon gift card reimbursement")
  - Account name shown below amount (e.g. "Venture – 2562", "Crew – 6169")
- Blue left-border accent on flagged/highlighted transactions
- Transactions visible:
  - May 30: Course Counseling `–$145.00` · Medical expenses
  - May 30: Birkenstock `–$132.69` · Garrett's Allowance
  - May 30: Amazon `–$48.29` · Garrett's Allowance
  - May 30: Claude.ai `–$21.49` · Garrett's Allowance _(cleared)_
  - May 30: Shiny Carwash `–$15.00` · Car maintenance
  - May 30: Amazon `–$7.41` · Garrett's Allowance _(cleared)_
  - May 30: Transfer from Venmo `+$51.66` · Crew – 6169 _(with memo)_
  - May 13: Panda Express `–$12.00` · BoA Atmos – 2347 _(reconciled)_
  - May 12: Check deposit `+$20.00` · Crew – 6169 _(reconciled)_

---

## 7. Category Drill-Down Screens

### 7a. Assigned in May — Moves Screen

> Opened by tapping `>` on "Assigned for [Month]" in the Category Detail screen

- **Header**: "Moves" (centered) + blue checkmark button (top-right)
- Entries grouped by date
- Each row shows:
  - Source category with emoji (left, e.g. "Groceries" or "Ready to Assign ⚡")
  - Arrow `→`
  - Destination category with emoji (e.g. "Garrett's Allowance")
  - Amount (right, green with `+` prefix)
- Entries visible:
  - May 30, 2026: Groceries → Garrett's Allowance · `+$18.26`
  - April 30, 2026: Ready to Assign ⚡ → Garrett's Allowance · `+$75.00`

### 7b. Activity in May — Transaction List

> Opened by tapping `>` on "Activity in [Month]" in the Category Detail screen

- **Header**: "Activity" (centered) + `Select` button + blue checkmark (top-right)
- Transactions grouped by date
- Each row shows:
  - Payee name (bold)
  - Amount (outflow negative, inflow green positive)
  - Cleared indicator circle (right of amount)
  - Account name sub-label (e.g. "Venture – 2562", "Crew – 6169")
  - Memo sub-label if present
- Transactions visible (from Garrett's Allowance category):
  - May 30: Birkenstock `–$132.69` · Venture – 2562
  - May 30: Amazon `–$48.29` · Venture – 2562
  - May 30: Claude.ai `–$21.49` · Venture – 2562 _(cleared)_
  - May 30: Amazon `–$7.41` · Venture – 2562 _(cleared)_
  - May 30: Transfer from Venmo `+$51.66` · Crew – 6169 _(with memo: "Amazon gift card reimbursement")_
  - May 13: Panda Express `–$12.00` · BoA Atmos – 2347 _(reconciled)_
  - May 12: Check deposit `+$20.00` · Crew – 6169 _(reconciled)_

---

## 8. Reconciliation Flow

> Accessed via the `...` overflow menu on the Account Detail screen

### 8a. Account Detail — `...` Overflow Menu

- Appears as a floating card (top-right of account detail screen)
- Menu items:
  - 🔒 **Reconcile** — sub-label shows "Reconciled X days ago"
  - 👁️ **Hide Reconciled** — toggles visibility of reconciled transactions in the list
  - ✏️ **Edit Account**
  - 💬 **Support**
  - ⚙️ **Settings & Privacy**

### 8b. Reconcile — Step 1: Confirm Balance

> Shown when "Reconcile" is tapped; asks user to verify cleared balance matches bank

- Modal card overlaid on the account detail screen
- **Body text**: "Your cleared balance in YNAB is $X. Does this match your bank balance?"
- Three buttons (stacked, full-width pills):
  - `Yes` (blue/filled — proceeds to lock reconciled transactions)
  - `No` (dark/outlined — proceeds to Step 2 to enter updated balance)
  - `Cancel` (text-style — dismisses modal)

### 8c. Reconcile — Step 2: Balances Match Confirmation

> Shown after tapping "Yes" (or after entering updated balance if "No" was chosen and balances now match)

- Modal card overlaid on account detail screen
- **Green checkmark icon** (top of card)
- **Body text**:
  - "Recent bank balance: $X" (bold)
  - "Cleared YNAB balance: $X" (bold)
  - Confirmation message: your cleared balance matches the most recent balance from your bank connection
- Three buttons (stacked, full-width pills):
  - `Looks Good!` (blue/filled — finalizes reconciliation, locks cleared transactions)
  - `Enter Updated Balance` (dark/outlined — allows manual override)
  - `Cancel` (text-style — dismisses without reconciling)

---

## 9. Bottom Navigation Bar

Persistent across all main screens. Five tabs:

- 🏠 **Home** — badge with unreviewed transaction count (e.g. `3`)
- 🏛️ **Plan**
- 💵 **Spending**
- 🏦 **Accounts**
- 📊 **Reflect**
