import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, requireRole } from "../middleware/auth.js";

const kpiQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  user: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  export: z.enum(["csv"]).optional()
});

const rankingSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  metric: z.enum(["orders", "boxes", "weight"]).default("orders"),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export const kpiRouter = Router();

kpiRouter.get("/", authRequired, requireRole(["admin", "supervisor"]), async (req, res) => {
  const parsed = kpiQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query inválida." });
  }

  const { from, to, user, page, pageSize, export: exportType } = parsed.data;
  const offset = (page - 1) * pageSize;
  const userFilter = user ? "AND user_name = $3" : "";
  const params = user ? [from, to, user] : [from, to];

  const totalsSql = `
    SELECT
      COALESCE(SUM(orders_count), 0) AS total_orders,
      COALESCE(SUM(boxes_count), 0) AS total_boxes,
      COALESCE(SUM(weight_kg), 0) AS total_weight
    FROM kpi_daily
    WHERE work_date BETWEEN $1::date AND $2::date
    ${userFilter}
  `;

  const trendSql = `
    SELECT
      work_date,
      SUM(orders_count)::int AS orders_count,
      SUM(boxes_count)::int AS boxes_count,
      SUM(weight_kg)::numeric(10,2) AS weight_kg
    FROM kpi_daily
    WHERE work_date BETWEEN $1::date AND $2::date
    ${userFilter}
    GROUP BY work_date
    ORDER BY work_date ASC
  `;

  const listSql = `
    SELECT
      id,
      user_name,
      orders_count,
      boxes_count,
      weight_kg,
      work_date
    FROM kpi_daily
    WHERE work_date BETWEEN $1::date AND $2::date
    ${userFilter}
    ORDER BY work_date DESC, user_name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [totals, trend] = await Promise.all([pool.query(totalsSql, params), pool.query(trendSql, params)]);

  if (exportType === "csv") {
    const csvRows = await pool.query(
      `
      SELECT user_name, work_date, orders_count, boxes_count, weight_kg
      FROM kpi_daily
      WHERE work_date BETWEEN $1::date AND $2::date
      ${userFilter}
      ORDER BY work_date DESC, user_name ASC
    `,
      params
    );

    const header = "Usuario,Data,Pedidos,Caixas,PesoKG";
    const lines = csvRows.rows.map((r) =>
      [r.user_name, r.work_date.toISOString().slice(0, 10), r.orders_count, r.boxes_count, r.weight_kg].join(",")
    );
    const csv = [header, ...lines].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=kpi_export.csv");
    return res.status(200).send(csv);
  }

  const list = await pool.query(listSql, [...params, pageSize, offset]);

  return res.json({
    filters: { from, to, user: user ?? null },
    cards: totals.rows[0],
    trend: trend.rows,
    items: list.rows,
    page,
    pageSize
  });
});

kpiRouter.get("/ranking", authRequired, requireRole(["admin", "supervisor"]), async (req, res) => {
  const parsed = rankingSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query inválida." });
  }

  const { from, to, metric, limit } = parsed.data;
  const metricColumn =
    metric === "orders" ? "SUM(orders_count)" : metric === "boxes" ? "SUM(boxes_count)" : "SUM(weight_kg)";

  const result = await pool.query(
    `
      SELECT
        user_name,
        ${metricColumn} AS metric_value
      FROM kpi_daily
      WHERE work_date BETWEEN $1::date AND $2::date
      GROUP BY user_name
      ORDER BY metric_value DESC
      LIMIT $3
    `,
    [from, to, limit]
  );

  return res.json({
    from,
    to,
    metric,
    items: result.rows
  });
});
