import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest } from "../middleware/auth.js";
import { pool } from "../db.js";

const recordSchema = z.object({
  maintenanceItem: z.string().min(1),
  name: z.string().min(1),
  operation: z.string().min(1),
  phoneModel: z.string().optional(),
  tabletModel: z.string().optional(),
  submittedAt: z.string().optional()
});

const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  name: z.string().optional(),
  operation: z.string().optional(),
  item: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const controlSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  name: z.string().optional(),
  operation: z.string().optional(),
  item: z.string().optional()
});

function requireTiAccess(req: AuthenticatedRequest): boolean {
  if (!req.user) return false;
  if (req.user.role === "admin") return true;
  return req.user.workspace === "ti";
}

export const tiRouter = Router();

tiRouter.post("/records", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Payload invalido." });
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

  const data = parsed.data;
  const submittedAt = data.submittedAt ? new Date(data.submittedAt) : new Date();

  const result = await pool.query(
    `
      INSERT INTO ti_device_records (
        submitted_at,
        maintenance_item,
        name,
        operation,
        phone_model,
        tablet_model,
        created_by_user_id,
        created_by_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      submittedAt,
      data.maintenanceItem.trim(),
      data.name.trim(),
      data.operation.trim(),
      data.phoneModel?.trim() || null,
      data.tabletModel?.trim() || null,
      req.user.id,
      req.user.name
    ]
  );

  return res.status(201).json(result.rows[0]);
});

tiRouter.get("/records", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, name, operation, item, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`r.submitted_at::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`r.submitted_at::date <= $${values.length}::date`);
  }
  if (name?.trim()) {
    values.push(`%${name.trim()}%`);
    filters.push(`r.name ILIKE $${values.length}`);
  }
  if (operation?.trim()) {
    values.push(`%${operation.trim()}%`);
    filters.push(`r.operation ILIKE $${values.length}`);
  }
  if (item?.trim()) {
    values.push(`%${item.trim()}%`);
    filters.push(`r.maintenance_item ILIKE $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  values.push(pageSize);
  values.push(offset);

  const result = await pool.query(
    `
      SELECT r.*
      FROM ti_device_records r
      ${where}
      ORDER BY r.submitted_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  return res.json({ items: result.rows, page, pageSize });
});

tiRouter.get("/control", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = controlSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, name, operation, item } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`r.submitted_at::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`r.submitted_at::date <= $${values.length}::date`);
  }
  if (name?.trim()) {
    values.push(`%${name.trim()}%`);
    filters.push(`r.name ILIKE $${values.length}`);
  }
  if (operation?.trim()) {
    values.push(`%${operation.trim()}%`);
    filters.push(`r.operation ILIKE $${values.length}`);
  }
  if (item?.trim()) {
    values.push(`%${item.trim()}%`);
    filters.push(`r.maintenance_item ILIKE $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const refDate = to || new Date().toISOString().slice(0, 10);
  values.push(refDate);

  const limits = await pool.query(
    `
      SELECT item, months_limit, max_count
      FROM ti_device_limits
    `
  );
  const limitMap = new Map<string, { months: number; max: number }>();
  for (const row of limits.rows) {
    limitMap.set(String(row.item).toLowerCase(), { months: Number(row.months_limit), max: Number(row.max_count) });
  }

  const windowed = await pool.query(
    `
      SELECT
        r.name,
        r.operation,
        r.maintenance_item,
        COUNT(*)::int AS total_count,
        MAX(r.submitted_at) AS last_date
      FROM ti_device_records r
      WHERE r.submitted_at::date <= $${values.length}::date
      GROUP BY r.name, r.operation, r.maintenance_item
      ORDER BY last_date DESC
    `,
    values
  );

  const monthSummary = await pool.query(
    `
      SELECT
        to_char(date_trunc('month', r.submitted_at), 'YYYY-MM') AS month,
        r.name,
        r.operation,
        r.maintenance_item,
        COUNT(*)::int AS total_count
      FROM ti_device_records r
      ${where}
      GROUP BY month, r.name, r.operation, r.maintenance_item
      ORDER BY month DESC
    `,
    values.slice(0, values.length - 1)
  );

  const limitRows = windowed.rows.map((row: any) => {
    const key = String(row.maintenance_item || "").toLowerCase();
    const limit = limitMap.get(key) || { months: 6, max: 1 };
    const start = new Date(refDate);
    start.setMonth(start.getMonth() - limit.months);
    return {
      name: row.name,
      operation: row.operation,
      maintenance_item: row.maintenance_item,
      total_count: Number(row.total_count),
      last_date: row.last_date,
      months_limit: limit.months,
      max_count: limit.max,
      status: Number(row.total_count) > limit.max ? "fora_do_limite" : "dentro_do_limite"
    };
  });

  return res.json({
    reference_date: refDate,
    limits: limitRows,
    monthly: monthSummary.rows
  });
});

