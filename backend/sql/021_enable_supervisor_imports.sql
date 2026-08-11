INSERT INTO role_screen_permissions (role, screen_key, is_enabled, updated_at)
VALUES ('supervisor', 'imports', true, now())
ON CONFLICT (role, screen_key)
DO UPDATE SET is_enabled = true, updated_at = now();
