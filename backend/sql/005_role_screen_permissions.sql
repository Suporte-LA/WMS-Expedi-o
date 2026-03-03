CREATE TABLE IF NOT EXISTS role_screen_permissions (
  role role_type NOT NULL,
  screen_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, screen_key)
);

INSERT INTO role_screen_permissions (role, screen_key, is_enabled)
VALUES
  ('admin', 'dashboard', true),
  ('admin', 'descents', true),
  ('admin', 'error-check', true),
  ('admin', 'error-reports', true),
  ('admin', 'imports', true),
  ('admin', 'users', true),
  ('admin', 'montagem-sp', true),
  ('supervisor', 'dashboard', true),
  ('supervisor', 'descents', true),
  ('supervisor', 'error-check', true),
  ('supervisor', 'error-reports', true),
  ('supervisor', 'imports', false),
  ('supervisor', 'users', true),
  ('supervisor', 'montagem-sp', true),
  ('operator', 'dashboard', false),
  ('operator', 'descents', true),
  ('operator', 'error-check', false),
  ('operator', 'error-reports', false),
  ('operator', 'imports', false),
  ('operator', 'users', false),
  ('operator', 'montagem-sp', true),
  ('conferente', 'dashboard', false),
  ('conferente', 'descents', false),
  ('conferente', 'error-check', true),
  ('conferente', 'error-reports', false),
  ('conferente', 'imports', false),
  ('conferente', 'users', false),
  ('conferente', 'montagem-sp', false)
ON CONFLICT (role, screen_key) DO NOTHING;
