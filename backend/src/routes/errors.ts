import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { imageUpload } from "../services/uploads.js";
import { pool } from "../db.js";
import { writeAuditLog } from "../services/audit.js";

const createSchema = z.object({
  orderNumber: z.string().min(1),
  problemType: z.string().min(2),
  finalized: z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true")),
  reportDate: z.string().optional(),
  dock: z.string().optional()
});

export const errorsRouter = Router();

function normalizeOrderNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

errorsRouter.post(
  "/",
  authRequired,
  requireRole(["admin", "supervisor", "conferente"]),
  imageUpload.single("image"),
  async (req: AuthenticatedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload invalido." });
  }
  if (!req.user) {
    return res.status(401).json({ message: "Nao autenticado." });
  }
  const normalizedOrder = normalizeOrderNumber(parsed.data.orderNumber);

  const descent = await pool.query(
    `
      SELECT id, descended_by_name, pen_color, created_at
      FROM descents
      WHERE order_number = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizedOrder]
  );

  const descentRow = descent.rows[0];
  const reportDate = parsed.data.reportDate || new Date().toISOString().slice(0, 10);
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const result = await pool.query(
    `
      INSERT INTO error_reports (
        order_number,
        problem_type,
        finalized,
        evidence_image_path,
        dock,
        report_date,
        conferente_user_id,
        conferente_name,
        descended_user_name,
        pen_color,
        descended_at,
        descent_id
      )
      VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `,
    [
      normalizedOrder,
      parsed.data.problemType,
      parsed.data.finalized,
      imagePath,
      parsed.data.dock || null,
      reportDate,
      req.user.id,
      req.user.name,
      descentRow?.descended_by_name || null,
      descentRow?.pen_color || null,
      descentRow?.created_at || null,
      descentRow?.id || null
    ]
  );

  await writeAuditLog({
    userId: req.user.id,
    action: "ERROR_CREATE",
    meta: { id: result.rows[0].id, orderNumber: normalizedOrder, problemType: parsed.data.problemType }
  });

  return res.status(201).json(result.rows[0]);
  }
);

errorsRouter.get("/", authRequired, requireRole(["admin", "supervisor"]), async (req, res) => {
  const parsed = z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
      problemType: z.string().optional(),
      conferente: z.string().optional(),
      user: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(30)
    })
    .safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to, problemType, conferente, user, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`e.report_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`e.report_date <= $${values.length}::date`);
  }
  if (problemType) {
    values.push(problemType);
    filters.push(`e.problem_type ILIKE $${values.length}`);
  }
  if (conferente) {
    values.push(conferente);
    filters.push(`e.conferente_name ILIKE $${values.length}`);
  }
  if (user) {
    values.push(user);
    filters.push(`e.descended_user_name ILIKE $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  values.push(pageSize);
  values.push(offset);

  const result = await pool.query(
    `
      SELECT e.*
      FROM error_reports e
      ${where}
      ORDER BY e.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  return res.json({ items: result.rows, page, pageSize });
});

errorsRouter.get("/dashboard", authRequired, requireRole(["admin", "supervisor"]), async (req, res) => {
  const parsed = z
    .object({
      from: z.string(),
      to: z.string()
    })
    .safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to } = parsed.data;
  const [byProblem, byConferente, byUser] = await Promise.all([
    pool.query(
      `
        SELECT problem_type, COUNT(*)::int AS total
        FROM error_reports
        WHERE report_date BETWEEN $1::date AND $2::date
        GROUP BY problem_type
        ORDER BY total DESC
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT conferente_name, COUNT(*)::int AS total
        FROM error_reports
        WHERE report_date BETWEEN $1::date AND $2::date
        GROUP BY conferente_name
        ORDER BY total DESC
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT COALESCE(descended_user_name, 'Sem usuario') AS user_name, COUNT(*)::int AS total
        FROM error_reports
        WHERE report_date BETWEEN $1::date AND $2::date
        GROUP BY COALESCE(descended_user_name, 'Sem usuario')
        ORDER BY total DESC
      `,
      [from, to]
    )
  ]);

  return res.json({
    byProblem: byProblem.rows,
    byConferente: byConferente.rows,
    byUser: byUser.rows
  });
});
