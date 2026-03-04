ALTER TABLE ti_stock_movements
ADD COLUMN IF NOT EXISTS movement_date date,
ADD COLUMN IF NOT EXISTS guide text,
ADD COLUMN IF NOT EXISTS movement_code text,
ADD COLUMN IF NOT EXISTS destination_final text;

UPDATE ti_stock_movements
SET movement_date = created_at::date
WHERE movement_date IS NULL;

