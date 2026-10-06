-- Optional cap on a `set_aside` target: keep assigning `amount_cents` every
-- month, but stop once the category's available balance reaches `cap_cents`
-- (e.g. medical: set aside $150/mo, capped at $300). NULL keeps today's
-- uncapped behavior. Derived progress is computed on read, never stored.
ALTER TABLE targets
  ADD COLUMN cap_cents bigint,
  ADD CONSTRAINT targets_cap_requires_set_aside CHECK (
    cap_cents IS NULL OR type = 'set_aside'
  ),
  ADD CONSTRAINT targets_cap_at_least_amount CHECK (
    cap_cents IS NULL OR cap_cents >= amount_cents
  );
