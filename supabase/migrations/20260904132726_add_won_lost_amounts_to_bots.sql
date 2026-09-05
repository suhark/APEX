/*
# Add won_amount and lost_amount columns to trading_bots

1. Modified Tables
- `trading_bots` gains `won_amount` (numeric, default 0) — total profit from winning trades
- `trading_bots` gains `lost_amount` (numeric, default 0) — total loss from losing trades

2. Security
- No policy changes. Existing RLS policies already cover the new columns.

3. Important Notes
- These columns let the UI show per-bot win/loss breakdowns without querying every trade.
- Idempotent: uses DO $$ ... IF NOT EXISTS ... END $$ to avoid errors on re-run.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'won_amount') THEN
    ALTER TABLE trading_bots ADD COLUMN won_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'lost_amount') THEN
    ALTER TABLE trading_bots ADD COLUMN lost_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;