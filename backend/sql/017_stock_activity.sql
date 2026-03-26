CREATE TABLE IF NOT EXISTS stock_inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL,
  description text NOT NULL,
  barcode text,
  supplier_code text,
  supplier_name text,
  local text,
  street text,
  expiry_date date NOT NULL,
  quantity_initial numeric(12,2) NOT NULL DEFAULT 0,
  quantity_remaining numeric(12,2) NOT NULL DEFAULT 0,
  source_type text NOT NULL DEFAULT 'validade',
  source_id uuid REFERENCES stock_expirations(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_inventory_lots_product_code ON stock_inventory_lots (product_code);
CREATE INDEX IF NOT EXISTS idx_stock_inventory_lots_expiry_date ON stock_inventory_lots (expiry_date);
CREATE INDEX IF NOT EXISTS idx_stock_inventory_lots_remaining ON stock_inventory_lots (quantity_remaining);

CREATE TABLE IF NOT EXISTS stock_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('entry', 'exit')),
  activity_type text NOT NULL CHECK (activity_type IN ('validade', 'abastecimento')),
  product_code text NOT NULL,
  description text NOT NULL,
  barcode text,
  supplier_code text,
  supplier_name text,
  local text,
  street text,
  expiry_date date,
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  operator_name text,
  related_record_id uuid,
  lot_id uuid REFERENCES stock_inventory_lots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_activity_logs_work_date ON stock_activity_logs (work_date);
CREATE INDEX IF NOT EXISTS idx_stock_activity_logs_product_code ON stock_activity_logs (product_code);
CREATE INDEX IF NOT EXISTS idx_stock_activity_logs_operator_name ON stock_activity_logs (operator_name);
CREATE INDEX IF NOT EXISTS idx_stock_activity_logs_activity_type ON stock_activity_logs (activity_type);
