-- OTP codes table for email verification / login
-- Each record is single-use and expires after 10 minutes.

create table if not exists public.otp_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code        text not null,           -- 6-digit numeric OTP (stored hashed)
  purpose     text not null default 'login',  -- 'login' | 'verify_email'
  attempts    int  not null default 0,  -- failed verify attempts (max 5)
  used        boolean not null default false,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

-- Index for fast lookup by email
create index if not exists otp_codes_email_idx on public.otp_codes (email, expires_at);

-- Auto-delete expired codes (runs every hour via pg_cron if enabled,
-- otherwise cleaned up by the verify function)
-- Enable RLS: only service_role can read/write (called from serverless functions)
alter table public.otp_codes enable row level security;

-- No client-side access — all operations go through /api/send-otp and /api/verify-otp
-- which run with the service_role key.
