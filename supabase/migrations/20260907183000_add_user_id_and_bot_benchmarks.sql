-- Add user_id to trading_workspace and trading_trades for multi-tenant data isolation
-- Add benchmark stats to trading_bots

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'user_id') THEN
    ALTER TABLE trading_workspace ADD COLUMN user_id uuid;
    CREATE INDEX IF NOT EXISTS idx_trading_workspace_user_id ON trading_workspace(user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_trades' AND column_name = 'user_id') THEN
    ALTER TABLE trading_trades ADD COLUMN user_id uuid;
    CREATE INDEX IF NOT EXISTS idx_trading_trades_user_id ON trading_trades(user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'benchmark_win_rate') THEN
    ALTER TABLE trading_bots ADD COLUMN benchmark_win_rate integer NOT NULL DEFAULT 68;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'benchmark_trades') THEN
    ALTER TABLE trading_bots ADD COLUMN benchmark_trades integer NOT NULL DEFAULT 142;
  END IF;
END $$;

-- Update initial benchmark values for known bots
UPDATE trading_bots SET benchmark_win_rate = 74, benchmark_trades = 186 WHERE name = 'Momentum Pulse';
UPDATE trading_bots SET benchmark_win_rate = 68, benchmark_trades = 124 WHERE name = 'Reverse Signal';
UPDATE trading_bots SET benchmark_win_rate = 71, benchmark_trades = 158 WHERE name = 'Range Scout';
UPDATE trading_bots SET benchmark_win_rate = 82, benchmark_trades = 246 WHERE name = 'Apex Momentum';
