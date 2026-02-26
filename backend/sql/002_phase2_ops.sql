ALTER TABLE users
ADD COLUMN IF NOT EXISTS pen_color text NOT NULL DEFAULT 'Blue';

CREATE TABLE IF NOT EXISTS descents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL,
  descended_by_user_id uuid NOT NULL REFERENCES users(id),
  descended_by_name text NOT NULL,
  pen_color text NOT NULL,
  product_image_path text,
  work_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_descents_work_date ON descents (work_date);
CREATE INDEX IF NOT EXISTS idx_descents_order_number ON descents (order_number);
CREATE INDEX IF NOT EXISTS idx_descents_user_date ON descents (descended_by_name, work_date);

CREATE TABLE IF NOT EXISTS error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL,
  problem_type text NOT NULL,
  finalized boolean NOT NULL DEFAULT false,
  evidence_image_path text,
  dock text,
  report_date date NOT NULL,
  conferente_user_id uuid NOT NULL REFERENCES users(id),
  conferente_name text NOT NULL,
  descended_user_name text,
  pen_color text,
  descended_at timestamptz,
  descent_id uuid REFERENCES descents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_reports_date ON error_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_error_reports_problem ON error_reports (problem_type);
CREATE INDEX IF NOT EXISTS idx_error_reports_order ON error_reports (order_number);
