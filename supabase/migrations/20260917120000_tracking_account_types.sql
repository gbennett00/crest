-- Widen account_type with YNAB-style tracking-only types (see
-- docs/budgeting-app-architecture.md § ACCOUNTS and § TRANSFERS). Split into
-- its own migration/transaction: Postgres forbids using a new enum value
-- inside the same transaction that added it, so the generated column and
-- trigger changes that reference 'asset'/'liability' live in the next
-- migration file.

ALTER TYPE account_type ADD VALUE 'asset';
ALTER TYPE account_type ADD VALUE 'liability';
