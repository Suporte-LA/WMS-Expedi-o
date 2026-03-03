CREATE TABLE IF NOT EXISTS montagem_sp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text,
  work_date date NOT NULL,
  loader_user_name text NOT NULL,
  start_time time,
  end_time time,
  duration_minutes int,
  stops_count int NOT NULL DEFAULT 0 CHECK (stops_count >= 0),
  pause_minutes int NOT NULL DEFAULT 0 CHECK (pause_minutes >= 0),
  pause_reason text,
  pallets_count int CHECK (pallets_count >= 0),
  load_value numeric(12,2),
  volume int CHECK (volume >= 0),
  weight_kg numeric(10,2) CHECK (weight_kg >= 0),
  isopor_qty int CHECK (isopor_qty >= 0),
  has_helper boolean NOT NULL DEFAULT false,
  helper_name text,
  photo_path text,
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_montagem_sp_work_date ON montagem_sp (work_date DESC);
CREATE INDEX IF NOT EXISTS idx_montagem_sp_loader_date ON montagem_sp (loader_user_name, work_date DESC);
