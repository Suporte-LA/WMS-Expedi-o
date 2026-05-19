ALTER TABLE descents
ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE error_reports
ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE montagem_sp
ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_descents_client_request_id
  ON descents (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_error_reports_client_request_id
  ON error_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_montagem_sp_client_request_id
  ON montagem_sp (client_request_id)
  WHERE client_request_id IS NOT NULL;
