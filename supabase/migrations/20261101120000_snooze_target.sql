-- Snooze a target for one budget month: Assign by Targets skips it and the
-- Available pill reads funded instead of underfunded. Stored as the snoozed
-- month (first-of-month DATE, like every budget month) so it expires on its
-- own — nothing resets it, and no history is kept.
--
-- It lives on the target's owner (category or group) rather than on `targets`
-- because the Sinking Fund's target is derived on read and has no row.
ALTER TABLE categories
  ADD COLUMN snoozed_month date,
  ADD CONSTRAINT categories_snoozed_month_first_of_month CHECK (
    snoozed_month IS NULL OR snoozed_month = date_trunc('month', snoozed_month)::date
  );

ALTER TABLE category_groups
  ADD COLUMN snoozed_month date,
  ADD CONSTRAINT category_groups_snoozed_month_first_of_month CHECK (
    snoozed_month IS NULL OR snoozed_month = date_trunc('month', snoozed_month)::date
  );
