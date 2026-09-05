-- Add Deriv connection tracking to the workspace
-- Stores whether the user has connected a Deriv account and the mode (demo/live)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'deriv_connected') THEN
    ALTER TABLE trading_workspace ADD COLUMN deriv_connected boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'deriv_loginid') THEN
    ALTER TABLE trading_workspace ADD COLUMN deriv_loginid text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'deriv_is_virtual') THEN
    ALTER TABLE trading_workspace ADD COLUMN deriv_is_virtual boolean;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_workspace' AND column_name = 'deriv_balance') THEN
    ALTER TABLE trading_workspace ADD COLUMN deriv_balance numeric;
  END IF;
END $$;
