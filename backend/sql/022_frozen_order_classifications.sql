CREATE TABLE IF NOT EXISTS frozen_order_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  order_number text NOT NULL,
  classified_by_user_id uuid REFERENCES users(id),
  classified_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_date, order_number)
);

CREATE INDEX IF NOT EXISTS idx_frozen_order_classifications_work_date
  ON frozen_order_classifications (work_date);
