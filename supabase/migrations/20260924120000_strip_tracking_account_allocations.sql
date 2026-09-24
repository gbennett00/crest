-- Tracking (off-budget) accounts never carry allocations (see
-- 20260917120100_tracking_accounts.sql), but reconcileWithAdjustment used to
-- assign every reconciliation balance adjustment to Ready to Assign regardless
-- of the account's on_budget status, leaking net-worth changes into the
-- budget. The application bug is fixed; remove any allocations it left behind
-- on tracking-account transactions. The split-sum triggers already exempt
-- off-budget accounts, so this delete is legal for approved transactions.

DELETE FROM transaction_allocations ta
USING transactions t
JOIN accounts a ON a.id = t.account_id
WHERE ta.transaction_id = t.id
  AND a.on_budget IS FALSE;
