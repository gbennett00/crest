-- Recurring "by date" targets: supports goals like "car insurance, $700 every
-- 6 months" or "$400 in Christmas every 12 months" without a background job.
-- `repeat_interval_months IS NULL` keeps today's one-shot behavior unchanged.
-- `target_date` stays the anchor/next-due date; rollover to the next
-- occurrence is computed on read (see lib/budget/compute.ts
-- effectiveTargetDate), never written back — derived values are never stored.

ALTER TABLE targets
  ADD COLUMN repeat_interval_months integer,
  ADD CONSTRAINT targets_repeat_requires_by_date CHECK (
    repeat_interval_months IS NULL OR type = 'by_date'
  ),
  ADD CONSTRAINT targets_repeat_interval_positive CHECK (
    repeat_interval_months IS NULL OR repeat_interval_months > 0
  );
