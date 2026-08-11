import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest, requireScreenAccess } from "../middleware/auth.js";
import { pool } from "../db.js";
import { imageUpload, persistUploadedImage } from "../services/uploads.js";
import { writeAuditLog } from "../services/audit.js";
import XLSX from "xlsx";

const createSchema = z.object({
  orderNumber: z.string().min(1),
  workDate: z.string().optional(),
  clientRequestId: z.string().min(1).optional()
});

const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  order: z.string().optional(),
  route: z.string().optional(),
  lot: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30)
});

const closingReportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  order: z.string().optional(),
  route: z.string().optional(),
  lot: z.string().optional()
});

export const descentsRouter = Router();

function normalizeOrderNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

function buildClosingReportFilters(query: z.infer<typeof closingReportSchema>) {
  const values: unknown[] = [query.date];
  const filters = ["c.base_date = $1::date"];

  if (query.order) {
    values.push(`%${query.order}%`);
    filters.push(`c.order_number ILIKE $${values.length}`);
  }
  if (query.route) {
    values.push(`%${query.route}%`);
    filters.push(`COALESCE(c.route, '') ILIKE $${values.length}`);
  }
  if (query.lot) {
    values.push(`%${query.lot}%`);
    filters.push(`COALESCE(c.lot, '') ILIKE $${values.length}`);
  }

  return { values, where: filters.join(" AND ") };
}

descentsRouter.post(
  "/",
  authRequired,
  requireScreenAccess("descents"),
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

    if (parsed.data.clientRequestId) {
      const existing = await pool.query(`SELECT * FROM descents WHERE client_request_id = $1 LIMIT 1`, [parsed.data.clientRequestId]);
      if (existing.rowCount) {
        return res.status(200).json(existing.rows[0]);
      }
    }

    const workDate = parsed.data.workDate || new Date().toISOString().slice(0, 10);
    const normalizedOrder = normalizeOrderNumber(parsed.data.orderNumber);
    const imagePath = await persistUploadedImage(req.file, "descents");
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

    const result = await pool.query(
      `
        INSERT INTO descents (
          order_number,
          descended_by_user_id,
          descended_by_name,
          pen_color,
          product_image_path,
          work_date,
          client_request_id,
          lot,
          volume,
          weight_kg,
          route
        )
        VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        normalizedOrder,
        req.user.id,
        userName,
        userPenColor,
        imagePath,
        workDate,
        parsed.data.clientRequestId || null,
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

descentsRouter.get("/", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to, user, order, route, lot, page, pageSize } = parsed.data;
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
    values.push(`%${user}%`);
    filters.push(`d.descended_by_name ILIKE $${values.length}`);
  }
  if (order) {
    values.push(`%${order}%`);
    filters.push(`d.order_number ILIKE $${values.length}`);
  }
  if (route) {
    values.push(`%${route}%`);
    filters.push(`COALESCE(d.route, '') ILIKE $${values.length}`);
  }
  if (lot) {
    values.push(`%${lot}%`);
    filters.push(`COALESCE(d.lot, '') ILIKE $${values.length}`);
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

descentsRouter.get("/dashboard", authRequired, requireScreenAccess("descents"), async (req, res) => {
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

descentsRouter.get("/closing-report", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = closingReportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma data valida para o fechamento." });
  }

  const { values, where } = buildClosingReportFilters(parsed.data);
  const [summary, pending] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS expected_orders,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = c.base_date
          ))::int AS scanned_orders,
          COUNT(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = c.base_date
          ))::int AS pending_orders
        FROM order_catalog c
        WHERE ${where}
      `,
      values
    ),
    pool.query(
      `
        SELECT c.order_number, c.route, c.lot, c.volume, c.weight_kg, c.description, c.base_date
        FROM order_catalog c
        WHERE ${where}
          AND NOT EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = c.base_date
          )
        ORDER BY c.route NULLS LAST, c.order_number
      `,
      values
    )
  ]);

  const cards = summary.rows[0];
  const expected = Number(cards?.expected_orders || 0);
  const scanned = Number(cards?.scanned_orders || 0);
  return res.json({
    cards: {
      expected_orders: expected,
      scanned_orders: scanned,
      pending_orders: Number(cards?.pending_orders || 0),
      completion_percentage: expected ? Number(((scanned / expected) * 100).toFixed(1)) : 0
    },
    items: pending.rows
  });
});

descentsRouter.get("/closing-report/export", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = closingReportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma data valida para o fechamento." });
  }

  const { values, where } = buildClosingReportFilters(parsed.data);
  const result = await pool.query(
    `
      SELECT c.order_number, c.route, c.lot, c.volume, c.weight_kg, c.description, c.base_date
      FROM order_catalog c
      WHERE ${where}
        AND NOT EXISTS (
          SELECT 1 FROM descents d
          WHERE d.order_number = c.order_number
            AND d.work_date = c.base_date
        )
      ORDER BY c.route NULLS LAST, c.order_number
    `,
    values
  );

  const rows = result.rows.map((row) => ({
    Pedido: row.order_number,
    Rota: row.route || "",
    Lote: row.lot || "",
    Volumes: row.volume ?? "",
    "Peso (kg)": row.weight_kg ?? "",
    Descricao: row.description || "",
    Data: String(row.base_date).slice(0, 10),
    Situacao: "Nao bipado"
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [12, 14, 12, 10, 12, 40, 12, 14].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, worksheet, "Nao bipados");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="pedidos-nao-bipados-${parsed.data.date}.xlsx"`);
  return res.send(buffer);
});

descentsRouter.get("/lookup/:orderNumber", authRequired, requireScreenAccess("error-check"), async (req, res) => {
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

descentsRouter.get("/catalog/:orderNumber", authRequired, requireScreenAccess("descents"), async (req, res) => {
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
