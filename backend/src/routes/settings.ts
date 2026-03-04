import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { pool } from "../db.js";
import { writeAuditLog } from "../services/audit.js";
import { supportsWorkspaceColumn } from "../services/workspaceSupport.js";

const ROLES = ["admin", "supervisor", "operator", "conferente"] as const;
const SCREENS = ["dashboard", "descents", "error-check", "error-reports", "imports", "users", "montagem-sp"] as const;
const WORKSPACES = ["expedicao", "estoque", "estoque-ti"] as const;

type Role = (typeof ROLES)[number];
type Screen = (typeof SCREENS)[number];
type Workspace = (typeof WORKSPACES)[number];

const updateSchema = z.object({
  permissions: z.array(
    z.object({
      role: z.enum(ROLES),
      screen_key: z.enum(SCREENS),
      is_enabled: z.boolean()
    })
  )
});

const workspaceUpdateSchema = z.object({
  permissions: z.array(
    z.object({
      user_id: z.string().uuid(),
      workspace: z.enum(WORKSPACES),
      is_enabled: z.boolean()
    })
  )
});

export const settingsRouter = Router();

const DEFAULT_PERMISSIONS: Array<{ role: Role; screen_key: Screen; is_enabled: boolean }> = [
  { role: "admin", screen_key: "dashboard", is_enabled: true },
  { role: "admin", screen_key: "descents", is_enabled: true },
  { role: "admin", screen_key: "error-check", is_enabled: true },
  { role: "admin", screen_key: "error-reports", is_enabled: true },
  { role: "admin", screen_key: "imports", is_enabled: true },
  { role: "admin", screen_key: "users", is_enabled: true },
  { role: "admin", screen_key: "montagem-sp", is_enabled: true },
  { role: "supervisor", screen_key: "dashboard", is_enabled: true },
  { role: "supervisor", screen_key: "descents", is_enabled: true },
  { role: "supervisor", screen_key: "error-check", is_enabled: true },
  { role: "supervisor", screen_key: "error-reports", is_enabled: true },
  { role: "supervisor", screen_key: "imports", is_enabled: false },
  { role: "supervisor", screen_key: "users", is_enabled: true },
  { role: "supervisor", screen_key: "montagem-sp", is_enabled: true },
  { role: "operator", screen_key: "dashboard", is_enabled: false },
  { role: "operator", screen_key: "descents", is_enabled: true },
  { role: "operator", screen_key: "error-check", is_enabled: false },
  { role: "operator", screen_key: "error-reports", is_enabled: false },
  { role: "operator", screen_key: "imports", is_enabled: false },
  { role: "operator", screen_key: "users", is_enabled: false },
  { role: "operator", screen_key: "montagem-sp", is_enabled: true },
  { role: "conferente", screen_key: "dashboard", is_enabled: false },
  { role: "conferente", screen_key: "descents", is_enabled: false },
  { role: "conferente", screen_key: "error-check", is_enabled: true },
  { role: "conferente", screen_key: "error-reports", is_enabled: false },
  { role: "conferente", screen_key: "imports", is_enabled: false },
  { role: "conferente", screen_key: "users", is_enabled: false },
  { role: "conferente", screen_key: "montagem-sp", is_enabled: false }
];

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_screen_permissions (
      role role_type NOT NULL,
      screen_key text NOT NULL,
      is_enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (role, screen_key)
    )
  `);

  for (const item of DEFAULT_PERMISSIONS) {
    await pool.query(
      `
        INSERT INTO role_screen_permissions (role, screen_key, is_enabled)
        VALUES ($1::role_type, $2, $3)
        ON CONFLICT (role, screen_key) DO NOTHING
      `,
      [item.role, item.screen_key, item.is_enabled]
    );
  }
}

async function ensureWorkspacePermissionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_workspace_permissions (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace text NOT NULL CHECK (workspace IN ('expedicao', 'estoque', 'estoque-ti')),
      is_enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, workspace)
    )
  `);

  const hasWorkspace = await supportsWorkspaceColumn();
  const users = await pool.query(
    hasWorkspace
      ? `SELECT id, role, workspace FROM users`
      : `SELECT id, role, 'expedicao'::text AS workspace FROM users`
  );

  for (const user of users.rows) {
    for (const workspace of WORKSPACES) {
      const enabled = user.role === "admin" ? true : user.workspace === workspace;
      await pool.query(
        `
          INSERT INTO user_workspace_permissions (user_id, workspace, is_enabled)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, workspace) DO NOTHING
        `,
        [user.id, workspace, enabled]
      );
    }
  }
}

settingsRouter.get("/access", authRequired, async (_req, res) => {
  await ensureSettingsTable();
  const result = await pool.query(
    `
      SELECT role, screen_key, is_enabled
      FROM role_screen_permissions
      WHERE role = ANY($1::role_type[]) AND screen_key = ANY($2::text[])
      ORDER BY role, screen_key
    `,
    [ROLES, SCREENS]
  );

  const permissions: Record<Role, Record<Screen, boolean>> = {
    admin: {
      dashboard: false,
      descents: false,
      "error-check": false,
      "error-reports": false,
      imports: false,
      users: false,
      "montagem-sp": false
    },
    supervisor: {
      dashboard: false,
      descents: false,
      "error-check": false,
      "error-reports": false,
      imports: false,
      users: false,
      "montagem-sp": false
    },
    operator: {
      dashboard: false,
      descents: false,
      "error-check": false,
      "error-reports": false,
      imports: false,
      users: false,
      "montagem-sp": false
    },
    conferente: {
      dashboard: false,
      descents: false,
      "error-check": false,
      "error-reports": false,
      imports: false,
      users: false,
      "montagem-sp": false
    }
  };

  for (const row of result.rows) {
    const role = row.role as Role;
    const screen = row.screen_key as Screen;
    permissions[role][screen] = Boolean(row.is_enabled);
  }

  return res.json({
    roles: ROLES,
    screens: SCREENS,
    permissions
  });
});

settingsRouter.put("/access", authRequired, requireRole(["admin"]), async (req: AuthenticatedRequest, res) => {
  await ensureSettingsTable();
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload invalido." });
  }

  await pool.query("BEGIN");
  try {
    for (const item of parsed.data.permissions) {
      await pool.query(
        `
          INSERT INTO role_screen_permissions (role, screen_key, is_enabled, updated_at)
          VALUES ($1::role_type, $2, $3, now())
          ON CONFLICT (role, screen_key)
          DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
        `,
        [item.role, item.screen_key, item.is_enabled]
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  await writeAuditLog({
    userId: req.user?.id,
    action: "SETTINGS_ACCESS_UPDATE",
    meta: { total: parsed.data.permissions.length }
  });

  return res.json({ ok: true });
});

settingsRouter.get("/workspaces", authRequired, requireRole(["admin"]), async (_req, res) => {
  await ensureWorkspacePermissionsTable();

  const users = await pool.query(`
    SELECT id, name, email, role, is_active
    FROM users
    ORDER BY name
  `);

  const permissionsRows = await pool.query(
    `
      SELECT user_id, workspace, is_enabled
      FROM user_workspace_permissions
      ORDER BY user_id, workspace
    `
  );

  const permissions: Record<string, Record<Workspace, boolean>> = {};
  for (const user of users.rows) {
    permissions[user.id] = { expedicao: false, estoque: false, "estoque-ti": false };
  }
  for (const row of permissionsRows.rows) {
    if (!permissions[row.user_id]) continue;
    permissions[row.user_id][row.workspace as Workspace] = Boolean(row.is_enabled);
  }

  return res.json({ users: users.rows, workspaces: WORKSPACES, permissions });
});

settingsRouter.put("/workspaces", authRequired, requireRole(["admin"]), async (req: AuthenticatedRequest, res) => {
  await ensureWorkspacePermissionsTable();
  const parsed = workspaceUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload invalido." });
  }

  await pool.query("BEGIN");
  try {
    for (const item of parsed.data.permissions) {
      await pool.query(
        `
          INSERT INTO user_workspace_permissions (user_id, workspace, is_enabled, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (user_id, workspace)
          DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
        `,
        [item.user_id, item.workspace, item.is_enabled]
      );
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  await writeAuditLog({
    userId: req.user?.id,
    action: "SETTINGS_ACCESS_UPDATE",
    meta: { type: "workspace-per-user", total: parsed.data.permissions.length }
  });

  return res.json({ ok: true });
});

settingsRouter.get("/workspaces/me", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

  if (req.user.role === "admin") {
    return res.json({ workspaces: WORKSPACES });
  }

  await ensureWorkspacePermissionsTable();

  const rows = await pool.query(
    `
      SELECT workspace
      FROM user_workspace_permissions
      WHERE user_id = $1 AND is_enabled = true
      ORDER BY workspace
    `,
    [req.user.id]
  );

  const workspaces = rows.rows.map((r) => r.workspace as Workspace);
  if (!workspaces.length) {
    return res.json({ workspaces: [req.user.workspace || "expedicao"] });
  }

  return res.json({ workspaces });
});
