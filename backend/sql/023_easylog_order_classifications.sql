CREATE TABLE IF NOT EXISTS easylog_order_classifications (
  work_date date NOT NULL,
  order_number text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('dry', 'frozen', 'unknown')),
  unread_count integer NOT NULL DEFAULT 0,
  dry_unread_count integer NOT NULL DEFAULT 0,
  frozen_unread_count integer NOT NULL DEFAULT 0,
  unknown_unread_count integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_date, order_number)
);

CREATE INDEX IF NOT EXISTS idx_easylog_order_classifications_frozen
  ON easylog_order_classifications (work_date, classification);
