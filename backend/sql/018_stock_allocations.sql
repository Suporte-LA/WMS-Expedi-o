CREATE TABLE IF NOT EXISTS stock_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  description TEXT NOT NULL,
  barcode TEXT,
  supplier_code TEXT,
  supplier_name TEXT,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  shed TEXT NOT NULL,
  street TEXT NOT NULL,
  building TEXT NOT NULL,
  apartment TEXT NOT NULL,
  pallet_position TEXT NOT NULL,
  position_code TEXT NOT NULL,
  position_label TEXT NOT NULL,
  pallet_code TEXT,
  allocation_mode TEXT NOT NULL DEFAULT 'single',
  operator_name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_allocations_product_code
  ON stock_allocations (product_code);

CREATE INDEX IF NOT EXISTS idx_stock_allocations_position_code
  ON stock_allocations (position_code);

CREATE INDEX IF NOT EXISTS idx_stock_allocations_pallet_code
  ON stock_allocations (pallet_code);

CREATE TABLE IF NOT EXISTS stock_allocation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID REFERENCES stock_allocations(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  product_code TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL,
  previous_position_code TEXT,
  previous_position_label TEXT,
  new_position_code TEXT NOT NULL,
  new_position_label TEXT NOT NULL,
  pallet_code TEXT,
  operator_name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_allocation_logs_product_code
  ON stock_allocation_logs (product_code, created_at DESC);
