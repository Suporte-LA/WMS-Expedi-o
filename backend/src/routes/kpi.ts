import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, requireRole } from "../middleware/auth.js";
import XLSX from "xlsx";

const kpiQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  user: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  export: z.enum(["csv", "xlsx"]).optional()
});

const rankingSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  metric: z.enum(["orders", "boxes", "weight"]).default("orders"),
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

export const kpiRouter = Router();

function combinedCte() {
  return `
    WITH descents_daily AS (
      SELECT
        d.descended_by_name AS user_name,
        d.work_date,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(d.volume), 0)::int AS boxes_count,
        COALESCE(SUM(d.weight_kg), 0)::numeric(10,2) AS weight_kg
      FROM descents d
      WHERE d.work_date BETWEEN $1::date AND $2::date
      GROUP BY d.descended_by_name, d.work_date
    ),
    combined_source AS (
      SELECT
        k.user_name,
        k.work_date,
        k.orders_count,
        k.boxes_count,
        k.weight_kg
      FROM kpi_daily k
      WHERE k.work_date BETWEEN $1::date AND $2::date

      UNION ALL

      SELECT
        dd.user_name,
        dd.work_date,
        dd.orders_count,
        dd.boxes_count,
        dd.weight_kg
      FROM descents_daily dd
      WHERE NOT EXISTS (
        SELECT 1
        FROM kpi_daily k
        WHERE k.user_name = dd.user_name
          AND k.work_date = dd.work_date
      )
    ),
    combined_kpi AS (
      SELECT
        user_name,
        work_date,
        SUM(orders_count)::int AS orders_count,
        SUM(boxes_count)::int AS boxes_count,
        SUM(weight_kg)::numeric(10,2) AS weight_kg
      FROM combined_source
      GROUP BY user_name, work_date
    )
  `;
}

kpiRouter.get("/", authRequired, requireRole(["admin", "supervisor"]), async (req, res) => {
  const parsed = kpiQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to, user, page, pageSize, export: exportType } = parsed.data;
  const offset = (page - 1) * pageSize;
  const params = user ? [from, to, user] : [from, to];
  const userFilter = user ? "AND c.user_name = $3" : "";

  const totalsSql = `
    ${combinedCte()}
    SELECT
      COALESCE(SUM(c.orders_count), 0) AS total_orders,
      COALESCE(SUM(c.boxes_count), 0) AS total_boxes,
      COALESCE(SUM(c.weight_kg), 0) AS total_weight
    FROM combined_kpi c
    WHERE 1=1
    ${userFilter}
  `;

  const trendSql = `
    ${combinedCte()}
    SELECT
      c.work_date,
      SUM(c.orders_count)::int AS orders_count,
      SUM(c.boxes_count)::int AS boxes_count,
      SUM(c.weight_kg)::numeric(10,2) AS weight_kg
    FROM combined_kpi c
    WHERE 1=1
    ${userFilter}
    GROUP BY c.work_date
    ORDER BY c.work_date ASC
  `;

  const listSql = `
    ${combinedCte()}
    SELECT
      CONCAT(c.user_name, '-', c.work_date::text) AS id,
      c.user_name,
      c.orders_count,
      c.boxes_count,
      c.weight_kg,
      c.work_date
    FROM combined_kpi c
    WHERE 1=1
    ${userFilter}
    ORDER BY c.work_date DESC, c.user_name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [totals, trend] = await Promise.all([pool.query(totalsSql, params), pool.query(trendSql, params)]);

  if (exportType === "csv" || exportType === "xlsx") {
    const exportRows = await pool.query(
      `
        ${combinedCte()}
        SELECT c.user_name, c.work_date, c.orders_count, c.boxes_count, c.weight_kg
        FROM combined_kpi c
        WHERE 1=1
        ${userFilter}
        ORDER BY c.work_date DESC, c.user_name ASC
      `,
      params
    );

    if (exportType === "csv") {
      const header = "Usuario,Data,Pedidos,Caixas,PesoKG";
      const lines = exportRows.rows.map((r) =>
        [r.user_name, r.work_date.toISOString().slice(0, 10), r.orders_count, r.boxes_count, r.weight_kg].join(",")
      );
      const csv = [header, ...lines].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=kpi_export.csv");
      return res.status(200).send(csv);
    }

    const worksheetRows = exportRows.rows.map((r) => ({
      Usuario: r.user_name,
      Data: r.work_date.toISOString().slice(0, 10),
      Pedidos: r.orders_count,
      Caixas: r.boxes_count,
      PesoKG: Number(r.weight_kg)
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(worksheetRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "KPI");
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=kpi_export.xlsx");
    return res.status(200).send(file);
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
    return res.status(400).json({ message: "Query invalida." });
  }

  const { from, to, metric, limit } = parsed.data;
  const metricColumn =
    metric === "orders" ? "SUM(c.orders_count)" : metric === "boxes" ? "SUM(c.boxes_count)" : "SUM(c.weight_kg)";

  const result = await pool.query(
    `
      ${combinedCte()}
      SELECT
        c.user_name,
        ${metricColumn} AS metric_value
      FROM combined_kpi c
      GROUP BY c.user_name
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
