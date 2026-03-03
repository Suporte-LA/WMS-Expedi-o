ALTER TABLE users
ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'expedicao';

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_workspace_check;

ALTER TABLE users
ADD CONSTRAINT users_workspace_check CHECK (workspace IN ('expedicao', 'estoque'));

