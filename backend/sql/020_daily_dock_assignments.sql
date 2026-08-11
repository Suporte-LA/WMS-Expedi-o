CREATE TABLE IF NOT EXISTS daily_dock_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  route_code text NOT NULL,
  route_name text NOT NULL,
  dock_position text NOT NULL CHECK (dock_position IN ('frente', 'tras')),
  created_by_user_id uuid REFERENCES users(id),
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_date, route_code)
);

CREATE INDEX IF NOT EXISTS idx_daily_dock_assignments_date
  ON daily_dock_assignments (work_date);
