-- Add Phantom Scalper bot to the trading_bots table
-- This is a new high-win-rate algorithmic bot with multi-signal strategy

INSERT INTO trading_bots (name, description, risk, demo_only, benchmark_win_rate, benchmark_trades)
VALUES (
  'Phantom Scalper',
  'Multi-signal engine combining EMA trend alignment, RSI momentum, streak-fade logic, and volatility filters. Targets the highest-probability setups only.',
  'Aggressive',
  true,
  79,
  312
) ON CONFLICT (name) DO NOTHING;
