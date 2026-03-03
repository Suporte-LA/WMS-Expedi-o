import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest, requireScreenAccess } from "../middleware/auth.js";
import { writeAuditLog } from "../services/audit.js";
import { supportsWorkspaceColumn } from "../services/workspaceSupport.js";

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "supervisor", "operator", "conferente"]),
  pen_color: z.string().min(1).default("Blue"),
  workspace: z.enum(["expedicao", "estoque"]).default("expedicao")
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(["admin", "supervisor", "operator", "conferente"]).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(6).optional(),
  pen_color: z.string().min(1).optional(),
  workspace: z.enum(["expedicao", "estoque"]).optional()
});

export const usersRouter = Router();

usersRouter.get("/", authRequired, requireScreenAccess("users"), async (_req, res) => {
  const hasWorkspace = await supportsWorkspaceColumn();
  const users = await pool.query(
    hasWorkspace
      ? `
          SELECT id, name, email, role, is_active, created_at, pen_color, workspace
          FROM users
          ORDER BY created_at DESC
        `
      : `
          SELECT id, name, email, role, is_active, created_at, pen_color
          FROM users
          ORDER BY created_at DESC
        `
  );
  return res.json({
    items: users.rows.map((u) => ({
      ...u,
      workspace: hasWorkspace ? u.workspace : "expedicao"
    }))
  });
});

usersRouter.post("/", authRequired, requireScreenAccess("users"), async (req: AuthenticatedRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Payload invalido.",
      errors: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message
      }))
    });
  }

  const { name, email, password, role, pen_color, workspace } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  const hasWorkspace = await supportsWorkspaceColumn();
  const result = await pool.query(
    hasWorkspace
      ? `
          INSERT INTO users (name, email, password_hash, role, pen_color, workspace)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, name, email, role, is_active, created_at, pen_color, workspace
        `
      : `
          INSERT INTO users (name, email, password_hash, role, pen_color)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, name, email, role, is_active, created_at, pen_color
        `,
    hasWorkspace ? [name, email.toLowerCase(), hash, role, pen_color, workspace] : [name, email.toLowerCase(), hash, role, pen_color]
  );

  await writeAuditLog({
    userId: req.user?.id,
    action: "USER_CREATE",
    meta: { createdUserId: result.rows[0].id, role }
  });

  return res.status(201).json({
    ...result.rows[0],
    workspace: hasWorkspace ? result.rows[0].workspace : "expedicao"
  });
});

usersRouter.patch("/:id", authRequired, requireScreenAccess("users"), async (req: AuthenticatedRequest, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Payload invalido.",
      errors: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message
      }))
    });
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(parsed.data.name);
  }
  if (parsed.data.role !== undefined) {
    fields.push(`role = $${idx++}`);
    values.push(parsed.data.role);
  }
  if (parsed.data.is_active !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(parsed.data.is_active);
  }
  if (parsed.data.password !== undefined) {
    fields.push(`password_hash = $${idx++}`);
    values.push(await bcrypt.hash(parsed.data.password, 10));
  }
  if (parsed.data.pen_color !== undefined) {
    fields.push(`pen_color = $${idx++}`);
    values.push(parsed.data.pen_color);
  }
  if (hasWorkspace && parsed.data.workspace !== undefined) {
    fields.push(`workspace = $${idx++}`);
    values.push(parsed.data.workspace);
  }

  if (!fields.length) {
    return res.status(400).json({ message: "Nada para atualizar." });
  }

  values.push(req.params.id);
  const result = await pool.query(
    hasWorkspace
      ? `
          UPDATE users
          SET ${fields.join(", ")}
          WHERE id = $${idx}
          RETURNING id, name, email, role, is_active, created_at, pen_color, workspace
        `
      : `
          UPDATE users
          SET ${fields.join(", ")}
          WHERE id = $${idx}
          RETURNING id, name, email, role, is_active, created_at, pen_color
        `,
    values
  );

  if (!result.rowCount) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  await writeAuditLog({
    userId: req.user?.id,
    action: "USER_UPDATE",
    meta: { updatedUserId: req.params.id, fields: Object.keys(parsed.data) }
  });

  return res.json({
    ...result.rows[0],
    workspace: hasWorkspace ? result.rows[0].workspace : "expedicao"
  });
});
  const hasWorkspace = await supportsWorkspaceColumn();
