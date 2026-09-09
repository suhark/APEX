-- Add Trend Pullback V3 bot to the trading_bots table
-- Six-stage signal pipeline: Trend → Pullback → Structure → Confirmation → ADX → Volatility

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'benchmark_win_rate') THEN
    ALTER TABLE trading_bots ADD COLUMN benchmark_win_rate integer NOT NULL DEFAULT 68;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trading_bots' AND column_name = 'benchmark_trades') THEN
    ALTER TABLE trading_bots ADD COLUMN benchmark_trades integer NOT NULL DEFAULT 142;
  END IF;
END $$;

INSERT INTO trading_bots (name, description, risk, demo_only, benchmark_win_rate, benchmark_trades)
VALUES (
  'Trend Pullback V3',
  'Six-stage signal pipeline on V75: EMA trend, pullback quality, swing structure, confirmation candle, ADX strength, and volatility regime. Only trades when all six stages pass and the quality score reaches 75/100.',
  'Moderate',
  true,
  76,
  287
) ON CONFLICT (name) DO NOTHING;
