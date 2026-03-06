CREATE TABLE IF NOT EXISTS ti_device_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  operation text NOT NULL,
  phone_model text,
  tablet_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ti_device_catalog_name_operation ON ti_device_catalog (name, operation);

