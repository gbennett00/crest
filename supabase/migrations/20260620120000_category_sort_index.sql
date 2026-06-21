-- Ordering for category groups and categories.
--
-- Previously the Plan view sorted groups/categories by (is_pinned, name); pins
-- now live on the Home screen and users can hand-order their budget. A
-- per-scope sort_index drives that order: groups are ordered globally, and
-- categories are ordered within their group.

ALTER TABLE category_groups
  ADD COLUMN sort_index integer NOT NULL DEFAULT 0;

ALTER TABLE categories
  ADD COLUMN sort_index integer NOT NULL DEFAULT 0;

-- Backfill from the current alphabetical order so existing budgets keep a
-- stable, sensible starting order.
WITH ordered AS (
  SELECT id, (row_number() OVER (ORDER BY name) - 1) AS rn
  FROM category_groups
)
UPDATE category_groups g
SET sort_index = o.rn
FROM ordered o
WHERE g.id = o.id;

WITH ordered AS (
  SELECT id, (row_number() OVER (PARTITION BY group_id ORDER BY name) - 1) AS rn
  FROM categories
)
UPDATE categories c
SET sort_index = o.rn
FROM ordered o
WHERE c.id = o.id;
