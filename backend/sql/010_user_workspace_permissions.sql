CREATE TABLE IF NOT EXISTS user_workspace_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace text NOT NULL CHECK (workspace IN ('expedicao', 'estoque', 'estoque-ti')),
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace)
);

