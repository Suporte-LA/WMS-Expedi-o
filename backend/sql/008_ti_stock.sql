CREATE TABLE IF NOT EXISTS ti_stock_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  cod text,
  category text,
  guides text,
  current_stock numeric(12,2) NOT NULL DEFAULT 0,
  min_stock numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ti_stock_products_cod ON ti_stock_products (cod);
CREATE INDEX IF NOT EXISTS idx_ti_stock_products_low ON ti_stock_products (current_stock, min_stock);

CREATE TABLE IF NOT EXISTS ti_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES ti_stock_products(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('entry', 'exit', 'return')),
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  stock_before numeric(12,2) NOT NULL,
  stock_after numeric(12,2) NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES users(id),
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ti_stock_movements_created_at ON ti_stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_stock_movements_product ON ti_stock_movements (product_id, created_at DESC);

