# APEX Trading Lab

Algorithmic execution terminal for synthetic volatility index trading with built-in risk guardrails. Built with React, TypeScript, Vite, Supabase, and the Deriv API.

---

## Features

- **Manual Trader** — full-featured tick chart with Rise/Fall contract execution on Deriv
- **Free Bots** — four algorithmic bots (Reverse Signal, Momentum Pulse, Range Scout, Apex Momentum)
- **Phantom Scalper** — multi-signal EMA/RSI/streak bot on Volatility indices
- **Trend Pullback V3** — six-stage signal pipeline (EMA trend, pullback, structure, confirmation candle, ADX, volatility regime)
- **Signal AI** — on-demand market read with manual approval before execution
- **Bulk Trader** — one strategy across multiple instruments simultaneously
- **Session loss guardrail** — configurable daily loss limit that stops all bots automatically
- **Account context isolation** — synthetic workspace and Deriv accounts tracked separately
- **Live arming system** — multi-step confirmation before any real-money execution

---

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Deriv](https://deriv.com) account and API token (for live trading)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/APEX.git
cd APEX
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values are found in your Supabase project under **Settings → API**.

### 3. Run Supabase migrations

Apply all migrations in order using the Supabase SQL Editor or CLI:

```bash
# Using Supabase CLI (if configured)
supabase db push
```

Or run each file manually in the **Supabase SQL Editor** in this order:

| File | Description |
|------|-------------|
| `20260904130959_create_trading_simulator_workspace.sql` | Creates base tables and seeds initial bots |
| `20260904132726_add_won_lost_amounts_to_bots.sql` | Adds won/lost amount columns to bots |
| `20260905101056_add_deriv_connection_to_workspace.sql` | Adds Deriv connection columns to workspace |
| `20260907183000_add_user_id_and_bot_benchmarks.sql` | Adds user_id isolation and benchmark stats |
| `20260908160000_lockdown_rls_and_user_bots.sql` | Enables strict RLS on all tables |
| `20260909120000_add_phantom_scalper_bot.sql` | Seeds Phantom Scalper bot |
| `20260909130000_add_trend_pullback_v3_bot.sql` | Seeds Trend Pullback V3 bot |
| `20260909140000_add_user_id_constraints.sql` | Adds NOT NULL + FK constraints on user_id |

### 4. Start the development server

```bash
npm run dev
```

---

## Development

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
npm run lint         # ESLint
npm run typecheck    # TypeScript type check
```

---

## Deployment

### Vercel

`vercel.json` is included at the project root. It sets all security headers (CSP, HSTS, X-Frame-Options) and the SPA rewrite rule. Deploy with:

```bash
vercel --prod
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the Vercel dashboard.

### Netlify

`public/_headers` is included and gets copied to `dist/` on build. It sets the same security headers. Deploy the `dist/` folder, or connect the repo and set the build command to `npm run build` with publish directory `dist`.

Set the two environment variables in Netlify's **Site settings → Environment variables**.

---

## Connecting Deriv

1. Log into [app.deriv.com](https://app.deriv.com) and go to **Settings → API Token**
2. Create a token with **Read**, **Trade**, and **Payments** scopes
3. In APEX → **Settings → Deriv connection**, paste the token and click Connect
4. The app defaults to Demo mode — arm live trading explicitly in Settings

> **Security note:** The Deriv API token is stored in `localStorage`. Use a scoped token (Read + Trade only) and revoke it after use if you have any concern about shared device access.

---

## Architecture

```
src/
├── App.tsx              # Main app shell, routing, all state management
├── auth-modal.tsx       # Sign in / sign up / forgot password modal
├── deriv-client.ts      # Deriv WebSocket client (connect, trade, subscribe)
├── deriv-connection.tsx # Deriv connection panel UI component
├── landing-page.tsx     # Marketing landing page
├── manual-trader.tsx    # Full-featured manual trade chart and order panel
├── policy-modal.tsx     # Privacy / Terms / Risk disclosure modal
├── use-deriv.ts         # React hook wrapping deriv-client singletons
└── index.css            # All styles (custom CSS, no Tailwind utilities)

supabase/migrations/     # All DB migrations in chronological order
public/
├── _headers             # Netlify security headers
└── apex-logo.png
vercel.json              # Vercel headers + SPA rewrite
```

---

## License

Private — all rights reserved.
