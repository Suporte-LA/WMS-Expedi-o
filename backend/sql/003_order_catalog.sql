CREATE TABLE IF NOT EXISTS order_catalog (
  order_number text PRIMARY KEY,
  lot text,
  volume int,
  weight_kg numeric(10,2),
  route text,
  description text,
  base_date date,
  source_import_id uuid REFERENCES imports(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_catalog_route ON order_catalog (route);

ALTER TABLE descents
ADD COLUMN IF NOT EXISTS lot text,
ADD COLUMN IF NOT EXISTS volume int,
ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2),
ADD COLUMN IF NOT EXISTS route text;
