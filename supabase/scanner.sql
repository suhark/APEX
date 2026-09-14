-- Compact V1 scanner persistence. Never store raw ticks here.
create table if not exists public.market_opportunities (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  market_family text not null,
  contract_type text not null check (contract_type in ('CALL', 'PUT', 'OVER', 'UNDER', 'MATCH', 'DIFF', 'EVEN', 'ODD')),
  direction text,
  barrier text,
  duration integer not null,
  duration_unit text not null default 't',
  score numeric not null check (score >= 0 and score <= 100),
  estimated_probability numeric not null check (estimated_probability >= 0 and estimated_probability <= 1),
  confidence_lower numeric not null check (confidence_lower >= 0 and confidence_lower <= 1),
  break_even_probability numeric not null check (break_even_probability >= 0 and break_even_probability <= 1),
  edge numeric not null,
  breakdown jsonb not null default '{}'::jsonb,
  status text not null check (status in ('NO SIGNAL', 'WATCH', 'QUALIFIED', 'POSITIVE EDGE', 'STRONG EDGE')),
  sample_size integer not null default 0,
  model_version text not null default 'v1',
  validation_version text not null default 'unvalidated',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists market_opportunities_config_idx
  on public.market_opportunities (symbol, contract_type, duration, duration_unit, model_version);
create index if not exists market_opportunities_active_idx
  on public.market_opportunities (symbol, expires_at, status);

alter table public.market_opportunities enable row level security;
create policy "Anyone can read active market opportunities"
  on public.market_opportunities for select
  using (expires_at > now());
