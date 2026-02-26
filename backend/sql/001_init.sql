CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE role_type AS ENUM ('admin', 'supervisor', 'operator');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE import_status_type AS ENUM ('processing', 'success', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role role_type NOT NULL DEFAULT 'operator',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  file_hash text NOT NULL,
  status import_status_type NOT NULL DEFAULT 'processing',
  processed_rows int NOT NULL DEFAULT 0,
  inserted_rows int NOT NULL DEFAULT 0,
  updated_rows int NOT NULL DEFAULT 0,
  rejected_rows int NOT NULL DEFAULT 0,
  rejection_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_by_user_id uuid REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name text NOT NULL,
  orders_count int NOT NULL CHECK (orders_count >= 0),
  boxes_count int NOT NULL CHECK (boxes_count >= 0),
  weight_kg numeric(10,2) NOT NULL CHECK (weight_kg >= 0),
  work_date date NOT NULL,
  source_import_id uuid REFERENCES imports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_name, work_date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_work_date ON kpi_daily (work_date);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);
