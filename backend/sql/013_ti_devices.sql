ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_workspace_check;

ALTER TABLE users
ADD CONSTRAINT users_workspace_check CHECK (workspace IN ('expedicao', 'estoque', 'estoque-ti', 'ti'));

CREATE TABLE IF NOT EXISTS ti_device_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  maintenance_item text NOT NULL,
  name text NOT NULL,
  operation text NOT NULL,
  phone_model text,
  tablet_model text,
  created_by_user_id uuid REFERENCES users(id),
  created_by_name text
);

CREATE INDEX IF NOT EXISTS idx_ti_device_records_submitted_at ON ti_device_records (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_device_records_name ON ti_device_records (name);
CREATE INDEX IF NOT EXISTS idx_ti_device_records_operation ON ti_device_records (operation);
CREATE INDEX IF NOT EXISTS idx_ti_device_records_item ON ti_device_records (maintenance_item);

CREATE TABLE IF NOT EXISTS ti_device_limits (
  item text PRIMARY KEY,
  months_limit int NOT NULL DEFAULT 6,
  max_count int NOT NULL DEFAULT 1
);

INSERT INTO ti_device_limits (item, months_limit, max_count)
VALUES
  ('pelicula', 6, 1),
  ('capinha', 6, 1),
  ('celular', 24, 1),
  ('tablet', 24, 1)
ON CONFLICT (item) DO NOTHING;

