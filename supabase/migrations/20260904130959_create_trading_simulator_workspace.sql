/*
# Create the single-tenant trading simulator workspace

1. New Tables
- `trading_workspace` stores the demo/live toggle, balance, loss limit, and enabled bots.
- `trading_trades` stores every simulated manual, bot, signal, and bulk trade for the public track record.
- `trading_bots` stores the user's bot activation state and basic configuration.

2. Security
- Row-level security is enabled on every table.
- This app has no sign-in screen yet, so anon and authenticated roles receive CRUD access to the intentionally shared demo workspace.

3. Important Notes
- This is synthetic trading only. No Deriv account is connected and no real funds are moved.
- Tables use generated UUIDs and timestamps so the front end can persist activity across reloads.
*/

CREATE TABLE IF NOT EXISTS trading_workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'demo',
  balance numeric NOT NULL DEFAULT 10000,
  starting_balance numeric NOT NULL DEFAULT 10000,
  loss_limit numeric NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument text NOT NULL,
  direction text NOT NULL,
  stake numeric NOT NULL,
  result text NOT NULL DEFAULT 'pending',
  profit numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  bot_name text,
  entry_price numeric NOT NULL,
  exit_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  risk text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  demo_only boolean NOT NULL DEFAULT true,
  total_trades integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  pnl numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trading_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shared_workspace_select" ON trading_workspace;
CREATE POLICY "shared_workspace_select" ON trading_workspace FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_workspace_insert" ON trading_workspace;
CREATE POLICY "shared_workspace_insert" ON trading_workspace FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared_workspace_update" ON trading_workspace;
CREATE POLICY "shared_workspace_update" ON trading_workspace FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared_workspace_delete" ON trading_workspace;
CREATE POLICY "shared_workspace_delete" ON trading_workspace FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared_trades_select" ON trading_trades;
CREATE POLICY "shared_trades_select" ON trading_trades FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_trades_insert" ON trading_trades;
CREATE POLICY "shared_trades_insert" ON trading_trades FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared_trades_update" ON trading_trades;
CREATE POLICY "shared_trades_update" ON trading_trades FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared_trades_delete" ON trading_trades;
CREATE POLICY "shared_trades_delete" ON trading_trades FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "shared_bots_select" ON trading_bots;
CREATE POLICY "shared_bots_select" ON trading_bots FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "shared_bots_insert" ON trading_bots;
CREATE POLICY "shared_bots_insert" ON trading_bots FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "shared_bots_update" ON trading_bots;
CREATE POLICY "shared_bots_update" ON trading_bots FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "shared_bots_delete" ON trading_bots;
CREATE POLICY "shared_bots_delete" ON trading_bots FOR DELETE TO anon, authenticated USING (true);

INSERT INTO trading_workspace (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM trading_workspace);

INSERT INTO trading_bots (name, description, risk, demo_only)
VALUES
  ('Reverse Signal', 'Enters after an overextended move reverses.', 'Conservative', true),
  ('Momentum Pulse', 'Follows short-term momentum on synthetic indices.', 'Moderate', true),
  ('Range Scout', 'Trades mean reversion inside calm price ranges.', 'Moderate', true),
  ('Apex Momentum', 'Multi-indicator flagship strategy with adaptive sizing.', 'Aggressive', true)
ON CONFLICT (name) DO NOTHING;