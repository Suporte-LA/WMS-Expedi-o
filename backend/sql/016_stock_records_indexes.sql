ALTER TABLE stock_replenishments
  ADD COLUMN IF NOT EXISTS supplier_code text,
  ADD COLUMN IF NOT EXISTS supplier_name text;

ALTER TABLE stock_expirations
  ADD COLUMN IF NOT EXISTS supplier_code text,
  ADD COLUMN IF NOT EXISTS supplier_name text;

CREATE INDEX IF NOT EXISTS idx_stock_replenishments_work_date ON stock_replenishments (work_date);
CREATE INDEX IF NOT EXISTS idx_stock_replenishments_product_code ON stock_replenishments (product_code);
CREATE INDEX IF NOT EXISTS idx_stock_expirations_work_date ON stock_expirations (work_date);
CREATE INDEX IF NOT EXISTS idx_stock_expirations_product_code ON stock_expirations (product_code);
