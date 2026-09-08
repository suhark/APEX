-- Migration: Lockdown Row-Level Security (RLS) and Isolate User Bots
-- Description:
-- 1. Adds active_bots array column to trading_workspace so bot states are isolated per user.
-- 2. Enforces strict RLS policies on trading_workspace and trading_trades (auth.uid() = user_id).
-- 3. Restricts trading_bots to read-only for client roles.

-- 1. Ensure active_bots column exists on trading_workspace
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'active_bots') THEN
    ALTER TABLE trading_workspace ADD COLUMN active_bots text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- 2. Lockdown trading_workspace RLS
ALTER TABLE trading_workspace ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_workspace_select" ON trading_workspace;
DROP POLICY IF EXISTS "shared_workspace_insert" ON trading_workspace;
DROP POLICY IF EXISTS "shared_workspace_update" ON trading_workspace;
DROP POLICY IF EXISTS "shared_workspace_delete" ON trading_workspace;
DROP POLICY IF EXISTS "user_workspace_select" ON trading_workspace;
DROP POLICY IF EXISTS "user_workspace_insert" ON trading_workspace;
DROP POLICY IF EXISTS "user_workspace_update" ON trading_workspace;
DROP POLICY IF EXISTS "user_workspace_delete" ON trading_workspace;

CREATE POLICY "user_workspace_select" ON trading_workspace
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_workspace_insert" ON trading_workspace
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_workspace_update" ON trading_workspace
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_workspace_delete" ON trading_workspace
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Lockdown trading_trades RLS
ALTER TABLE trading_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_trades_select" ON trading_trades;
DROP POLICY IF EXISTS "shared_trades_insert" ON trading_trades;
DROP POLICY IF EXISTS "shared_trades_update" ON trading_trades;
DROP POLICY IF EXISTS "shared_trades_delete" ON trading_trades;
DROP POLICY IF EXISTS "user_trades_select" ON trading_trades;
DROP POLICY IF EXISTS "user_trades_insert" ON trading_trades;
DROP POLICY IF EXISTS "user_trades_update" ON trading_trades;
DROP POLICY IF EXISTS "user_trades_delete" ON trading_trades;

CREATE POLICY "user_trades_select" ON trading_trades
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_trades_insert" ON trading_trades
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_trades_update" ON trading_trades
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_trades_delete" ON trading_trades
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Lockdown trading_bots (Read-only catalog for clients)
ALTER TABLE trading_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_bots_select" ON trading_bots;
DROP POLICY IF EXISTS "shared_bots_insert" ON trading_bots;
DROP POLICY IF EXISTS "shared_bots_update" ON trading_bots;
DROP POLICY IF EXISTS "shared_bots_delete" ON trading_bots;
DROP POLICY IF EXISTS "bots_catalog_select" ON trading_bots;

CREATE POLICY "bots_catalog_select" ON trading_bots
  FOR SELECT TO authenticated, anon
  USING (true);
