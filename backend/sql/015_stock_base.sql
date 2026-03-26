CREATE TABLE IF NOT EXISTS stock_base_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL,
  description text NOT NULL,
  barcode text,
  supplier_code text,
  supplier_name text,
  local text,
  street text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stock_base_products_product_code UNIQUE (product_code)
);

CREATE INDEX IF NOT EXISTS idx_stock_base_products_barcode ON stock_base_products (barcode);
CREATE INDEX IF NOT EXISTS idx_stock_base_products_supplier_name ON stock_base_products (supplier_name);
CREATE INDEX IF NOT EXISTS idx_stock_base_products_description ON stock_base_products (description);

CREATE TABLE IF NOT EXISTS stock_base_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  processed_rows int NOT NULL DEFAULT 0,
  inserted_rows int NOT NULL DEFAULT 0,
  updated_rows int NOT NULL DEFAULT 0,
  imported_by_user_id uuid REFERENCES users(id),
  imported_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_replenishments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  entry_time time,
  product_code text,
  description text,
  barcode text,
  quantity_1 numeric(12,2),
  expiry_1 date,
  quantity_2 numeric(12,2),
  expiry_2 date,
  user_name text,
  local text,
  street text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_expirations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  product_code text,
  description text,
  barcode text,
  quantity numeric(12,2),
  expiry_date date,
  user_name text,
  local text,
  street text,
  created_at timestamptz NOT NULL DEFAULT now()
);
