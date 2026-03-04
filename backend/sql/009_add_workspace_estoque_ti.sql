ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_workspace_check;

ALTER TABLE users
ADD CONSTRAINT users_workspace_check CHECK (workspace IN ('expedicao', 'estoque', 'estoque-ti'));

