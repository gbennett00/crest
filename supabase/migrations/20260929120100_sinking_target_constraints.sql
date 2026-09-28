-- Sinking targets repeat (like recurring by_date targets) but have no due
-- date: the Sinking Fund accrues amount / repeat_interval_months every month,
-- and moving money into the category at the start of a cycle is manual.
ALTER TABLE targets DROP CONSTRAINT targets_repeat_requires_by_date;
ALTER TABLE targets ADD CONSTRAINT targets_repeat_requires_recurring_type CHECK (
  repeat_interval_months IS NULL OR type IN ('by_date', 'sinking')
);
ALTER TABLE targets ADD CONSTRAINT targets_sinking_shape CHECK (
  type <> 'sinking' OR (repeat_interval_months IS NOT NULL AND target_date IS NULL)
);

-- The Sinking Fund category's target is now derived on read (the sum of every
-- sinking target's monthly share), never stored. Drop any target an earlier
-- version of the wizard wrote to it.
DELETE FROM targets
WHERE category_id IN (SELECT id FROM categories WHERE role = 'sinking_fund');
