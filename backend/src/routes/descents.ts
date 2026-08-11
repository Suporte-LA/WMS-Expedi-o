import { Router } from "express";
import { z } from "zod";
import { authRequired, AuthenticatedRequest, requireRole, requireScreenAccess } from "../middleware/auth.js";
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

const dockAssignmentSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  routeCode: z.string().trim().min(1).max(80),
  routeName: z.string().trim().min(1).max(160).optional(),
  dockPosition: z.enum(["frente", "tras"])
});

export const descentsRouter = Router();

function normalizeOrderNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

function saoPauloToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function buildClosingReportFilters(query: z.infer<typeof closingReportSchema>) {
  const values: unknown[] = [query.date];
  const deliveryDateSql = `(
    $1::date + CASE EXTRACT(ISODOW FROM $1::date)::int
      WHEN 5 THEN 3
      WHEN 6 THEN 2
      ELSE 1
    END
  )`;
  const filters = [
    `c.base_date = ${deliveryDateSql}`,
    `c.source_import_id = (
      SELECT i.id
      FROM imports i
      WHERE i.status = 'success'
        AND i.rejection_report->>'type' = 'BASE'
      ORDER BY i.imported_at DESC
      LIMIT 1
    )`,
    `COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'`,
    `COALESCE(c.description, '') NOT ILIKE '%REDES KA%'`
  ];

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

  return { values, where: filters.join(" AND "), deliveryDateSql };
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

    const workDate = parsed.data.workDate || saoPauloToday();
    if (workDate !== saoPauloToday() && req.user.role !== "admin" && req.user.role !== "supervisor") {
      return res.status(422).json({ message: "Operadores so podem registrar pedidos na data de hoje." });
    }
    const normalizedOrder = normalizeOrderNumber(parsed.data.orderNumber);
    const catalog = await pool.query(
      `
        SELECT c.lot, c.volume, c.weight_kg, c.route, c.description, c.base_date,
               i.imported_at AS base_imported_at
        FROM order_catalog c
        JOIN imports i ON i.id = c.source_import_id
        WHERE c.order_number = $1
          AND c.base_date = (
            $2::date + CASE EXTRACT(ISODOW FROM $2::date)::int
              WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1
            END
          )
          AND c.source_import_id = (
            SELECT id FROM imports
            WHERE status = 'success' AND rejection_report->>'type' = 'BASE'
            ORDER BY imported_at DESC LIMIT 1
          )
          AND COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'
          AND COALESCE(c.description, '') NOT ILIKE '%REDES KA%'
        LIMIT 1
      `,
      [normalizedOrder, workDate]
    );
    const orderInfo = catalog.rows[0];
    if (!orderInfo) {
      return res.status(422).json({ message: "Pedido nao pertence a base valida deste turno." });
    }

    if (orderInfo.route) {
      const dock = await pool.query(
        `SELECT dock_position FROM daily_dock_assignments WHERE work_date = $1::date AND route_code = UPPER(TRIM($2)) LIMIT 1`,
        [workDate, orderInfo.route]
      );
      if (!dock.rowCount) {
        return res.status(422).json({ message: `Rota ${orderInfo.route} ainda esta sem doca definida pelo supervisor.` });
      }
    }

    const duplicate = await pool.query(
      `SELECT descended_by_name, created_at FROM descents WHERE order_number = $1 AND work_date = $2::date ORDER BY created_at ASC LIMIT 1`,
      [normalizedOrder, workDate]
    );
    if (duplicate.rowCount) {
      return res.status(409).json({
        message: `Pedido ja bipado por ${duplicate.rows[0].descended_by_name}.`,
        duplicate: duplicate.rows[0]
      });
    }

    const imagePath = await persistUploadedImage(req.file, "descents");
    const userInfo = await pool.query(`SELECT name, pen_color FROM users WHERE id = $1 LIMIT 1`, [req.user.id]);
    const userName = userInfo.rows[0]?.name || req.user.name;
    const userPenColor = userInfo.rows[0]?.pen_color || req.user.pen_color || "Blue";

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

descentsRouter.get("/dock-assignments", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma data valida." });
  }
  const result = await pool.query(
    `
      WITH latest_base AS (
        SELECT id
        FROM imports
        WHERE status = 'success' AND rejection_report->>'type' = 'BASE'
        ORDER BY imported_at DESC
        LIMIT 1
      ), routes AS (
        SELECT
          TRIM(c.route) AS route_code,
          COUNT(*)::int AS orders_count,
          MIN(NULLIF(TRIM(c.description), '')) AS route_description
        FROM order_catalog c, latest_base i
        WHERE c.source_import_id = i.id
          AND c.route IS NOT NULL
          AND TRIM(c.route) <> ''
          AND COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'
          AND COALESCE(c.description, '') NOT ILIKE '%REDES KA%'
          AND c.base_date = (
            $1::date + CASE EXTRACT(ISODOW FROM $1::date)::int
              WHEN 5 THEN 3
              WHEN 6 THEN 2
              ELSE 1
            END
          )
        GROUP BY TRIM(c.route)
      )
      SELECT
        d.id,
        $1::date AS work_date,
        r.route_code,
        COALESCE(NULLIF(d.route_name, d.route_code), r.route_description, r.route_code) AS route_name,
        r.route_description,
        d.dock_position,
        COALESCE(d.created_by_name, '') AS created_by_name,
        d.created_at,
        d.updated_at,
        r.orders_count
      FROM routes r
      LEFT JOIN daily_dock_assignments d
        ON d.work_date = $1::date
       AND d.route_code = UPPER(r.route_code)
      ORDER BY r.route_code
    `,
    [parsed.data.date]
  );
  return res.json({ items: result.rows });
});

descentsRouter.post(
  "/dock-assignments",
  authRequired,
  requireScreenAccess("descents"),
  requireRole(["admin", "supervisor"]),
  async (req: AuthenticatedRequest, res) => {
    const parsed = dockAssignmentSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ message: "Preencha data, rota, nome e posicao da doca." });
    }
    const routeCode = parsed.data.routeCode.toUpperCase();
    const result = await pool.query(
      `
        INSERT INTO daily_dock_assignments (
          work_date, route_code, route_name, dock_position, created_by_user_id, created_by_name
        )
        VALUES ($1::date, $2, $3, $4, $5, $6)
        ON CONFLICT (work_date, route_code)
        DO UPDATE SET
          route_name = EXCLUDED.route_name,
          dock_position = EXCLUDED.dock_position,
          created_by_user_id = EXCLUDED.created_by_user_id,
          created_by_name = EXCLUDED.created_by_name,
          updated_at = now()
        RETURNING *
      `,
      [parsed.data.workDate, routeCode, parsed.data.routeName || routeCode, parsed.data.dockPosition, req.user.id, req.user.name]
    );
    await writeAuditLog({
      userId: req.user.id,
      action: "DAILY_DOCK_ASSIGNMENT_UPSERT",
      meta: { workDate: parsed.data.workDate, routeCode, dockPosition: parsed.data.dockPosition }
    });
    return res.status(201).json(result.rows[0]);
  }
);

descentsRouter.delete(
  "/dock-assignments/:id",
  authRequired,
  requireScreenAccess("descents"),
  requireRole(["admin", "supervisor"]),
  async (req: AuthenticatedRequest, res) => {
    const result = await pool.query(`DELETE FROM daily_dock_assignments WHERE id = $1 RETURNING *`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "Registro de doca nao encontrado." });
    await writeAuditLog({ userId: req.user?.id, action: "DAILY_DOCK_ASSIGNMENT_DELETE", meta: { id: req.params.id } });
    return res.status(204).send();
  }
);

descentsRouter.get("/closing-report", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = closingReportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma data valida para o fechamento." });
  }

  const { values, where, deliveryDateSql } = buildClosingReportFilters(parsed.data);
  const [summary, pending, unexpected, unexpectedItems, duplicates, baseInfo, routeProgress] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS expected_orders,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = $1::date
          ))::int AS scanned_orders,
          COUNT(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = $1::date
          ))::int AS pending_orders
        FROM order_catalog c
        WHERE ${where}
      `,
      values
    ),
    pool.query(
      `
        SELECT
          c.order_number, c.route, c.lot, c.volume, c.weight_kg, c.description,
          $1::date AS operation_date,
          ${deliveryDateSql} AS delivery_date
        FROM order_catalog c
        WHERE ${where}
          AND NOT EXISTS (
            SELECT 1 FROM descents d
            WHERE d.order_number = c.order_number
              AND d.work_date = $1::date
          )
        ORDER BY c.route NULLS LAST, c.order_number
      `,
      values
    ),
    pool.query(
      `
        SELECT COUNT(DISTINCT d.order_number)::int AS unexpected_orders
        FROM descents d
        WHERE d.work_date = $1::date
          AND NOT EXISTS (
            SELECT 1
            FROM order_catalog c
            WHERE c.order_number = d.order_number
              AND c.base_date = ${deliveryDateSql}
              AND c.source_import_id = (
                SELECT i.id FROM imports i
                WHERE i.status = 'success' AND i.rejection_report->>'type' = 'BASE'
                ORDER BY i.imported_at DESC LIMIT 1
              )
          )
      `,
      [parsed.data.date]
    ),
    pool.query(
      `SELECT d.order_number, MIN(d.created_at) AS scanned_at,
              MIN(d.descended_by_name) AS descended_by_name, COUNT(*)::int AS scans
       FROM descents d
       WHERE d.work_date = $1::date
         AND NOT EXISTS (
           SELECT 1 FROM order_catalog c
           WHERE c.order_number = d.order_number AND c.base_date = ${deliveryDateSql}
             AND c.source_import_id = (SELECT id FROM imports WHERE status = 'success' AND rejection_report->>'type' = 'BASE' ORDER BY imported_at DESC LIMIT 1)
         )
       GROUP BY d.order_number ORDER BY scanned_at`,
      [parsed.data.date]
    ),
    pool.query(
      `SELECT order_number, COUNT(*)::int AS scans, MIN(created_at) AS first_scan_at,
              MAX(created_at) AS last_scan_at, STRING_AGG(DISTINCT descended_by_name, ', ') AS operators
       FROM descents WHERE work_date = $1::date
       GROUP BY order_number HAVING COUNT(*) > 1 ORDER BY last_scan_at DESC`,
      [parsed.data.date]
    ),
    pool.query(
      `SELECT i.imported_at, i.filename,
              COUNT(DISTINCT c.route) FILTER (
                WHERE c.route IS NOT NULL AND TRIM(c.route) <> '' AND d.id IS NULL
              )::int AS routes_without_dock
       FROM imports i
       LEFT JOIN order_catalog c ON c.source_import_id = i.id AND c.base_date = ${deliveryDateSql}
         AND COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'
         AND COALESCE(c.description, '') NOT ILIKE '%REDES KA%'
       LEFT JOIN daily_dock_assignments d ON d.work_date = $1::date AND d.route_code = UPPER(TRIM(c.route))
       WHERE i.id = (SELECT id FROM imports WHERE status = 'success' AND rejection_report->>'type' = 'BASE' ORDER BY imported_at DESC LIMIT 1)
       GROUP BY i.id, i.imported_at, i.filename`,
      [parsed.data.date]
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(TRIM(c.route), ''), 'SEM ROTA') AS route,
              COUNT(*)::int AS expected_orders,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM descents d WHERE d.order_number = c.order_number AND d.work_date = $1::date))::int AS scanned_orders,
              MAX((SELECT MAX(d.created_at) FROM descents d WHERE d.order_number = c.order_number AND d.work_date = $1::date)) AS last_scan_at
       FROM order_catalog c WHERE ${where}
       GROUP BY COALESCE(NULLIF(TRIM(c.route), ''), 'SEM ROTA') ORDER BY route`,
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
      unexpected_orders: Number(unexpected.rows[0]?.unexpected_orders || 0),
      completion_percentage: expected ? Number(((scanned / expected) * 100).toFixed(1)) : 0
    },
    operation_date: parsed.data.date,
    delivery_date: pending.rows[0]?.delivery_date || null,
    base: baseInfo.rows[0] || null,
    exceptions: {
      unexpected: unexpectedItems.rows,
      duplicates: duplicates.rows,
      routes_without_dock: Number(baseInfo.rows[0]?.routes_without_dock || 0)
    },
    route_progress: routeProgress.rows.map((row) => ({
      ...row,
      pending_orders: Number(row.expected_orders) - Number(row.scanned_orders),
      completion_percentage: Number(row.expected_orders) ? Number(((Number(row.scanned_orders) / Number(row.expected_orders)) * 100).toFixed(1)) : 0
    })),
    items: pending.rows
  });
});

descentsRouter.get("/closing-report/export", authRequired, requireScreenAccess("descents"), async (req, res) => {
  const parsed = closingReportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma data valida para o fechamento." });
  }

  const { values, where, deliveryDateSql } = buildClosingReportFilters(parsed.data);
  const result = await pool.query(
    `
      SELECT
        c.order_number, c.route, c.lot, c.volume, c.weight_kg, c.description,
        $1::date AS operation_date,
        ${deliveryDateSql} AS delivery_date
      FROM order_catalog c
      WHERE ${where}
        AND NOT EXISTS (
          SELECT 1 FROM descents d
          WHERE d.order_number = c.order_number
            AND d.work_date = $1::date
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
    "Data do turno": String(row.operation_date).slice(0, 10),
    "Data da entrega": String(row.delivery_date).slice(0, 10),
    Situacao: "Nao bipado"
  }));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [12, 14, 12, 10, 12, 40, 14, 16, 14].map((wch) => ({ wch }));
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
  const workDate = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : saoPauloToday();
  const result = await pool.query(
    `
      SELECT c.order_number, c.lot, c.volume, c.weight_kg, c.route, c.description, c.base_date,
             i.imported_at AS base_imported_at
      FROM order_catalog c
      JOIN imports i ON i.id = c.source_import_id
      WHERE c.order_number = $1
        AND c.base_date = (
          $2::date + CASE EXTRACT(ISODOW FROM $2::date)::int
            WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1
          END
        )
        AND c.source_import_id = (
          SELECT id FROM imports
          WHERE status = 'success' AND rejection_report->>'type' = 'BASE'
          ORDER BY imported_at DESC LIMIT 1
        )
        AND COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'
        AND COALESCE(c.description, '') NOT ILIKE '%REDES KA%'
      LIMIT 1
    `,
    [normalizeOrderNumber(String(req.params.orderNumber)), workDate]
  );
  if (!result.rowCount) {
    return res.status(404).json({ message: "Pedido nao encontrado na base." });
  }
  return res.json(result.rows[0]);
});
