-- Migration: Strengthen user_id columns with NOT NULL constraints and FK references
-- This ensures orphaned rows cannot exist and user deletions cascade correctly.
--
-- Safe to run multiple times — all changes use IF NOT EXISTS / conditional DO blocks.

-- ─── trading_workspace ────────────────────────────────────────────────────────

-- 1. Back-fill any null user_id rows that slipped in before RLS was enforced
--    (sets them to a sentinel UUID so NOT NULL can be applied; RLS already hides them)
UPDATE trading_workspace
SET user_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE user_id IS NULL;

-- 2. Apply NOT NULL constraint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trading_workspace'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE trading_workspace ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- 3. Add FK → auth.users with cascade delete (workspace deleted when user is deleted)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trading_workspace_user_id_fkey'
      AND table_name = 'trading_workspace'
  ) THEN
    ALTER TABLE trading_workspace
      ADD CONSTRAINT trading_workspace_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ─── trading_trades ───────────────────────────────────────────────────────────

-- 1. Back-fill null user_id rows
UPDATE trading_trades
SET user_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE user_id IS NULL;

-- 2. Apply NOT NULL constraint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trading_trades'
      AND column_name = 'user_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE trading_trades ALTER COLUMN user_id SET NOT NULL;
  END IF;
END $$;

-- 3. Add FK → auth.users with cascade delete (trades deleted when user is deleted)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trading_trades_user_id_fkey'
      AND table_name = 'trading_trades'
  ) THEN
    ALTER TABLE trading_trades
      ADD CONSTRAINT trading_trades_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;
