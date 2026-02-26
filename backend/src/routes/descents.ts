import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { pool } from "../db.js";
import { imageUpload } from "../services/uploads.js";
import { writeAuditLog } from "../services/audit.js";

const createSchema = z.object({
  orderNumber: z.string().min(1),
  workDate: z.string().optional()
});

const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  order: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30)
});

export const descentsRouter = Router();

function normalizeOrderNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

descentsRouter.post(
  "/",
  authRequired,
  requireRole(["admin", "supervisor", "operator"]),
  imageUpload.single("image"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Payload invalido." });
    }
    if (!req.user) {
      return res.status(401).json({ message: "Nao autenticado." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Foto do produto e obrigatoria." });
    }

    const workDate = parsed.data.workDate || new Date().toISOString().slice(0, 10);
    const normalizedOrder = normalizeOrderNumber(parsed.data.orderNumber);
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
    const userInfo = await pool.query(`SELECT name, pen_color FROM users WHERE id = $1 LIMIT 1`, [req.user.id]);
    const userName = userInfo.rows[0]?.name || req.user.name;
    const userPenColor = userInfo.rows[0]?.pen_color || req.user.pen_color || "Blue";
    const catalog = await pool.query(
      `
        SELECT lot, volume, weight_kg, route, description
        FROM order_catalog
        WHERE order_number = $1
        LIMIT 1
      `,
      [normalizedOrder]
    );
    const orderInfo = catalog.rows[0];
    if (!orderInfo) {
      return res.status(400).json({ message: "Pedido nao encontrado na Base. Preencha a base antes de registrar." });
    }
    if (
      !orderInfo.lot ||
      orderInfo.volume === null ||
      orderInfo.weight_kg === null ||
      !orderInfo.route ||
      !orderInfo.description
    ) {
      return res.status(400).json({
        message: "Cadastro da Base incompleto para este pedido (lote, volume, peso, rota e descricao obrigatorios)."
      });
    }

    const result = await pool.query(
      `
        INSERT INTO descents (
          order_number,
          descended_by_user_id,
          descended_by_name,
          pen_color,
          product_image_path,
          work_date,
          lot,
          volume,
          weight_kg,
          route
        )
        VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        normalizedOrder,
        req.user.id,
        userName,
        userPenColor,
        imagePath,
        workDate,
        orderInfo?.lot ?? null,
        orderInfo?.volume ?? null,
        orderInfo?.weight_kg ?? null,
        orderInfo?.route ?? null
      ]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "DESCENT_CREATE",
      meta: { id: result.rows[0].id, orderNumber: normalizedOrder, userPenColor }
    });

    return res.status(201).json(result.rows[0]);
  }
);

descentsRouter.get("/", authRequired, requireRole(["admin", "supervisor", "operator"]), async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to, user, order, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`d.work_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`d.work_date <= $${values.length}::date`);
  }
  if (user) {
    values.push(user);
    filters.push(`d.descended_by_name ILIKE $${values.length}`);
  }
  if (order) {
    values.push(`%${order}%`);
    filters.push(`d.order_number ILIKE $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  values.push(pageSize);
  values.push(offset);

  const result = await pool.query(
    `
      SELECT d.*
      FROM descents d
      ${where}
      ORDER BY d.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  return res.json({ items: result.rows, page, pageSize });
});

descentsRouter.get("/dashboard", authRequired, requireRole(["admin", "supervisor", "operator"]), async (req, res) => {
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
  const [totals, byUser, byDay] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_descents,
          COUNT(DISTINCT order_number)::int AS total_orders
        FROM descents
        WHERE work_date BETWEEN $1::date AND $2::date
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT descended_by_name AS user_name, COUNT(*)::int AS total
        FROM descents
        WHERE work_date BETWEEN $1::date AND $2::date
        GROUP BY descended_by_name
        ORDER BY total DESC
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT work_date, COUNT(*)::int AS total
        FROM descents
        WHERE work_date BETWEEN $1::date AND $2::date
        GROUP BY work_date
        ORDER BY work_date ASC
      `,
      [from, to]
    )
  ]);

  return res.json({
    cards: totals.rows[0],
    byUser: byUser.rows,
    byDay: byDay.rows
  });
});

descentsRouter.get("/lookup/:orderNumber", authRequired, requireRole(["admin", "supervisor", "conferente"]), async (req, res) => {
  const result = await pool.query(
    `
      SELECT id, order_number, descended_by_name, pen_color, work_date, created_at
        , lot, volume, weight_kg, route
      FROM descents
      WHERE order_number = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalizeOrderNumber(String(req.params.orderNumber))]
  );

  if (!result.rowCount) {
    return res.status(404).json({ message: "Pedido nao encontrado em descidas." });
  }
  return res.json(result.rows[0]);
});

descentsRouter.get("/catalog/:orderNumber", authRequired, requireRole(["admin", "supervisor", "operator"]), async (req, res) => {
  const result = await pool.query(
    `
      SELECT order_number, lot, volume, weight_kg, route, description, base_date
      FROM order_catalog
      WHERE order_number = $1
      LIMIT 1
    `,
    [normalizeOrderNumber(String(req.params.orderNumber))]
  );
  if (!result.rowCount) {
    return res.status(404).json({ message: "Pedido nao encontrado na base." });
  }
  return res.json(result.rows[0]);
});
