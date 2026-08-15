-- Restore the service_role grants that Supabase normally configures at project
-- init. A fresh Supabase project grants service_role full access to the public
-- schema AND sets ALTER DEFAULT PRIVILEGES so every future object is auto-granted.
-- An unsafe DB reset wiped those, so service_role was left without table-level
-- privileges — the Plaid webhook (which uses the service key and relies on
-- service_role bypassing RLS) hit "permission denied for table plaid_items"
-- (SQLSTATE 42501) before RLS was ever evaluated.
--
-- This migration re-establishes both halves, mirroring how 20260524120005
-- does it for the authenticated role. It is idempotent and safe to run against
-- a healthy DB (GRANTs and default-privilege rules just stack harmlessly).

-- 1. Backfill: grant service_role everything that already exists.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 2. Auto-grant future objects — this is what makes new tables/functions
--    reachable by service_role without spelling each one out. Applies to
--    objects created by the role running the migration (postgres), which is
--    the same role your migrations create tables as.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO service_role;
