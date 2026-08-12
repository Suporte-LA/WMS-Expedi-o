import { createHash } from "crypto";
import { NextFunction, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest, requireScreenAccess } from "../middleware/auth.js";
import { writeAuditLog } from "../services/audit.js";
import { parseKpiFile, parseOrderCatalogFile } from "../services/importParser.js";

const upload = multer({ storage: multer.memoryStorage() });
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

const easylogCandidatesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const easylogClassificationSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    orderNumber: z.string().trim().min(1),
    classification: z.enum(["dry", "frozen", "unknown"]),
    unreadCount: z.number().int().min(0),
    dryUnreadCount: z.number().int().min(0),
    frozenUnreadCount: z.number().int().min(0),
    unknownUnreadCount: z.number().int().min(0)
  })).max(2500)
});

export const importsRouter = Router();

function baseImportAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const configuredKey = process.env.EASYLOG_SYNC_KEY?.trim();
  const receivedKey = String(req.headers["x-easylog-sync-key"] || "").trim();
  if (configuredKey && receivedKey && receivedKey === configuredKey) {
    (req as AuthenticatedRequest & { easylogAutomation?: boolean }).easylogAutomation = true;
    return next();
  }
  return authRequired(req, res, () => requireScreenAccess("imports")(req, res, next));
}

function easylogAutomationRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const configuredKey = process.env.EASYLOG_SYNC_KEY?.trim();
  const receivedKey = String(req.headers["x-easylog-sync-key"] || "").trim();
  if (configuredKey && receivedKey === configuredKey) return next();
  return res.status(401).json({ message: "Chave de sincronizacao invalida." });
}

importsRouter.get("/easylog/candidates", easylogAutomationRequired, async (req, res) => {
  const parsed = easylogCandidatesSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Data operacional invalida." });

  const result = await pool.query(
    `SELECT c.order_number
     FROM order_catalog c
     WHERE c.base_date = (
       $1::date + CASE EXTRACT(ISODOW FROM $1::date)::int
         WHEN 5 THEN 3 WHEN 6 THEN 2 ELSE 1
       END
     )
       AND COALESCE(c.description, '') NOT ILIKE '%PEDIDO PESSOAL%'
       AND COALESCE(c.description, '') NOT ILIKE '%REDES KA%'
       AND NOT EXISTS (
         SELECT 1 FROM descents d
         WHERE d.work_date = $1::date AND d.order_number = c.order_number
       )
       AND NOT EXISTS (
         SELECT 1 FROM frozen_order_classifications f
         WHERE f.work_date = $1::date AND f.order_number = c.order_number
       )
     ORDER BY c.order_number`,
    [parsed.data.date]
  );
  return res.json({ workDate: parsed.data.date, orderNumbers: result.rows.map((row) => row.order_number) });
});

importsRouter.post("/easylog/classifications", easylogAutomationRequired, async (req, res) => {
  const parsed = easylogClassificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Classificacoes EasyLog invalidas." });
  const { workDate, items } = parsed.data;
  if (!items.length) return res.json({ processed: 0, frozen: 0 });

  await pool.query(
    `WITH data AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
         order_number text, classification text, unread_count int,
         dry_unread_count int, frozen_unread_count int, unknown_unread_count int
       )
     )
     INSERT INTO easylog_order_classifications (
       work_date, order_number, classification, unread_count,
       dry_unread_count, frozen_unread_count, unknown_unread_count, checked_at
     )
     SELECT $2::date, order_number, classification, unread_count,
            dry_unread_count, frozen_unread_count, unknown_unread_count, now()
     FROM data
     ON CONFLICT (work_date, order_number) DO UPDATE SET
       classification = EXCLUDED.classification,
       unread_count = EXCLUDED.unread_count,
       dry_unread_count = EXCLUDED.dry_unread_count,
       frozen_unread_count = EXCLUDED.frozen_unread_count,
       unknown_unread_count = EXCLUDED.unknown_unread_count,
       checked_at = now()`,
    [JSON.stringify(items.map((item) => ({
      order_number: item.orderNumber.replace(/\D/g, "") || item.orderNumber,
      classification: item.classification,
      unread_count: item.unreadCount,
      dry_unread_count: item.dryUnreadCount,
      frozen_unread_count: item.frozenUnreadCount,
      unknown_unread_count: item.unknownUnreadCount
    }))), workDate]
  );

  return res.json({ processed: items.length, frozen: items.filter((item) => item.classification === "frozen").length });
});

async function upsertOrderCatalogRows(
  rows: ReturnType<typeof parseOrderCatalogFile>,
  importId: string,
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }
) {
  let inserted = 0;
  let updated = 0;

  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const orderNumbers = chunk.map((r) => r.order_number);

    const existing = await client.query(
      `
        SELECT COUNT(*)::int AS c
        FROM order_catalog
        WHERE order_number = ANY($1::text[])
      `,
      [orderNumbers]
    );
    const existingCount = Number(existing.rows[0]?.c || 0);

    const result = await client.query(
      `
        WITH data AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS x(
            order_number text,
            lot text,
            volume int,
            weight_kg numeric,
            route text,
            description text,
            base_date date
          )
        )
        INSERT INTO order_catalog (
          order_number, lot, volume, weight_kg, route, description, base_date, source_import_id
        )
        SELECT
          d.order_number, d.lot, d.volume, d.weight_kg, d.route, d.description, d.base_date, $2
        FROM data d
        ON CONFLICT (order_number)
        DO UPDATE SET
          lot = EXCLUDED.lot,
          volume = EXCLUDED.volume,
          weight_kg = EXCLUDED.weight_kg,
          route = EXCLUDED.route,
          description = EXCLUDED.description,
          base_date = EXCLUDED.base_date,
          source_import_id = EXCLUDED.source_import_id,
          updated_at = now()
        RETURNING 1
      `,
      [JSON.stringify(chunk), importId]
    );

    const affected = result.rows.length;
    const chunkInserted = Math.max(0, affected - existingCount);
    const chunkUpdated = Math.min(existingCount, affected);
    inserted += chunkInserted;
    updated += chunkUpdated;
  }

  return { inserted, updated };
}

async function insertOnlyOrderCatalogRows(
  rows: ReturnType<typeof parseOrderCatalogFile>,
  importId: string,
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }
) {
  const chunkSize = 1000;
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const orderNumbers = chunk.map((r) => r.order_number);
    const existing = await client.query(
      `
        SELECT COUNT(*)::int AS c
        FROM order_catalog
        WHERE order_number = ANY($1::text[])
      `,
      [orderNumbers]
    );
    const existingCount = Number(existing.rows[0]?.c || 0);

    const result = await client.query(
      `
        WITH data AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS x(
            order_number text,
            lot text,
            volume int,
            weight_kg numeric,
            route text,
            description text,
            base_date date
          )
        )
        INSERT INTO order_catalog (
          order_number, lot, volume, weight_kg, route, description, base_date, source_import_id
        )
        SELECT
          d.order_number, d.lot, d.volume, d.weight_kg, d.route, d.description, d.base_date, $2
        FROM data d
        ON CONFLICT (order_number) DO NOTHING
        RETURNING 1
      `,
      [JSON.stringify(chunk), importId]
    );
    inserted += result.rows.length;
    skipped += existingCount;
  }

  return { inserted, updated: 0, skipped };
}

async function consolidateDescentsFromCatalog(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }
) {
  const result = await client.query(
    `
      UPDATE descents d
      SET
        lot = COALESCE(d.lot, c.lot),
        volume = COALESCE(d.volume, c.volume),
        weight_kg = COALESCE(d.weight_kg, c.weight_kg),
        route = COALESCE(d.route, c.route)
      FROM order_catalog c
      WHERE d.order_number = c.order_number
        AND (
          d.lot IS NULL OR
          d.volume IS NULL OR
          d.weight_kg IS NULL OR
          d.route IS NULL
        )
      RETURNING 1
    `
  );
  return result.rows.length;
}

importsRouter.post(
  "/kpi",
  authRequired,
  requireScreenAccess("imports"),
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Arquivo obrigatório." });
    }

    const sheetName = typeof req.body.sheetName === "string" ? req.body.sheetName : undefined;
    let parsedFile;
    try {
      parsedFile = parseKpiFile({
        filename: req.file.originalname,
        fileBuffer: req.file.buffer,
        sheetName
      });
    } catch (error) {
      return res.status(400).json({
        message: error instanceof Error ? error.message : "Erro ao processar arquivo."
      });
    }

    const importInsert = await pool.query(
      `
        INSERT INTO imports (
          filename,
          file_hash,
          status,
          processed_rows,
          inserted_rows,
          updated_rows,
          rejected_rows,
          rejection_report,
          imported_by_user_id
        )
        VALUES ($1, $2, 'processing', 0, 0, 0, 0, $3::jsonb, $4)
        RETURNING id
      `,
      [
        req.file.originalname,
        parsedFile.fileHash,
        JSON.stringify(parsedFile.rejectionReasons),
        req.user?.id
      ]
    );

    const importId = importInsert.rows[0].id as string;
    await writeAuditLog({
      userId: req.user?.id,
      action: "IMPORT_CREATE",
      meta: { importId, filename: req.file.originalname }
    });

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;

    try {
      await client.query("BEGIN");
      for (const row of parsedFile.rows) {
        const result = await client.query(
          `
            INSERT INTO kpi_daily (
              user_name,
              orders_count,
              boxes_count,
              weight_kg,
              work_date,
              source_import_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_name, work_date)
            DO UPDATE SET
              orders_count = EXCLUDED.orders_count,
              boxes_count = EXCLUDED.boxes_count,
              weight_kg = EXCLUDED.weight_kg,
              source_import_id = EXCLUDED.source_import_id,
              updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `,
          [
            row.user_name,
            row.orders_count,
            row.boxes_count,
            row.weight_kg,
            row.work_date,
            importId
          ]
        );
        if (result.rows[0].inserted) inserted += 1;
        else updated += 1;
      }

      await client.query(
        `
          UPDATE imports
          SET
            status = 'success',
            processed_rows = $2,
            inserted_rows = $3,
            updated_rows = $4,
            rejected_rows = $5,
            rejection_report = $6::jsonb
          WHERE id = $1
        `,
        [
          importId,
          parsedFile.rows.length + parsedFile.rejectionReasons.length,
          inserted,
          updated,
          parsedFile.rejectionReasons.length,
          JSON.stringify(parsedFile.rejectionReasons)
        ]
      );

      await client.query("COMMIT");
      await writeAuditLog({
        userId: req.user?.id,
        action: "IMPORT_SUCCESS",
        meta: {
          importId,
          inserted,
          updated,
          rejected: parsedFile.rejectionReasons.length
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      await pool.query(`UPDATE imports SET status = 'failed' WHERE id = $1`, [importId]);
      await writeAuditLog({
        userId: req.user?.id,
        action: "IMPORT_FAIL",
        meta: { importId, error: error instanceof Error ? error.message : "unknown" }
      });
      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      importId,
      summary: {
        processedRows: parsedFile.rows.length + parsedFile.rejectionReasons.length,
        insertedRows: inserted,
        updatedRows: updated,
        rejectedRows: parsedFile.rejectionReasons.length
      },
      preview: parsedFile.preview,
      rejections: parsedFile.rejectionReasons
    });
  }
);

importsRouter.post(
  "/base",
  baseImportAccess,
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Arquivo XLSX obrigatorio." });
    }

    const lower = req.file.originalname.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return res.status(400).json({ message: "Use apenas arquivo XLSX/XLS para base." });
    }

    const fileHash = createHash("sha256").update(req.file.buffer).digest("hex");
    const isAutomation = Boolean((req as AuthenticatedRequest & { easylogAutomation?: boolean }).easylogAutomation);
    if (isAutomation) {
      const duplicate = await pool.query(
        `SELECT id, imported_at FROM imports WHERE file_hash = $1 AND status = 'success' LIMIT 1`,
        [fileHash]
      );
      if (duplicate.rowCount) {
        return res.status(200).json({ unchanged: true, importId: duplicate.rows[0].id, importedAt: duplicate.rows[0].imported_at });
      }
    }

    const rows = parseOrderCatalogFile({
      filename: req.file.originalname,
      fileBuffer: req.file.buffer
    });

    if (!rows.length) {
      return res.status(400).json({ message: "Nenhuma linha valida da aba Base foi encontrada no arquivo." });
    }

    const previousBase = await pool.query(
      `SELECT processed_rows, imported_at, filename FROM imports
       WHERE status = 'success' AND rejection_report->>'type' = 'BASE'
       ORDER BY imported_at DESC LIMIT 1`
    );
    const previousCount = Number(previousBase.rows[0]?.processed_rows || 0);
    const changePercentage = previousCount ? Math.round(((rows.length - previousCount) / previousCount) * 100) : 0;
    const requiresConfirmation = previousCount > 0 && Math.abs(changePercentage) >= 35;
    if (requiresConfirmation && req.body.confirmLargeChange !== "true" && !isAutomation) {
      return res.status(409).json({
        message: `A nova base tem ${rows.length} pedidos (${changePercentage > 0 ? "+" : ""}${changePercentage}% comparado aos ${previousCount} anteriores). Confirme para continuar.`,
        requiresConfirmation: true,
        comparison: {
          currentRows: rows.length,
          previousRows: previousCount,
          changePercentage,
          previousFilename: previousBase.rows[0]?.filename,
          previousImportedAt: previousBase.rows[0]?.imported_at
        }
      });
    }

    const importInsert = await pool.query(
      `
        INSERT INTO imports (
          filename,
          file_hash,
          status,
          processed_rows,
          inserted_rows,
          updated_rows,
          rejected_rows,
          rejection_report,
          imported_by_user_id
        )
        VALUES ($1, $2, 'processing', 0, 0, 0, 0, $3::jsonb, $4)
        RETURNING id
      `,
      [
        req.file.originalname,
        fileHash,
        JSON.stringify({ type: "BASE", source: isAutomation ? "EASYLOG_AUTO" : "MANUAL" }),
        req.user?.id
      ]
    );
    const importId = importInsert.rows[0].id as string;

    await writeAuditLog({
      userId: req.user?.id,
      action: "IMPORT_CREATE",
      meta: { importId, filename: req.file.originalname, type: "BASE", source: isAutomation ? "EASYLOG_AUTO" : "MANUAL" }
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const summary = await upsertOrderCatalogRows(rows, importId, client);
      const consolidatedDescents = await consolidateDescentsFromCatalog(client);
      await client.query(
        `
          UPDATE imports
          SET
            status = 'success',
            processed_rows = $2,
            inserted_rows = $3,
            updated_rows = $4,
            rejected_rows = 0,
            rejection_report = $5::jsonb
          WHERE id = $1
        `,
        [importId, rows.length, summary.inserted, summary.updated, JSON.stringify({ type: "BASE", source: isAutomation ? "EASYLOG_AUTO" : "MANUAL" })]
      );
      await client.query("COMMIT");

      await writeAuditLog({
        userId: req.user?.id,
        action: "IMPORT_SUCCESS",
        meta: { importId, type: "BASE", processed: rows.length, ...summary, consolidatedDescents }
      });

      return res.status(201).json({
        importId,
        validation: {
          previousRows: previousCount,
          changePercentage,
          deliveryDates: [...new Set(rows.map((row) => row.base_date))].sort()
        },
        summary: {
          processedRows: rows.length,
          insertedRows: summary.inserted,
          updatedRows: summary.updated,
          rejectedRows: 0,
          consolidatedDescents
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      await pool.query(`UPDATE imports SET status = 'failed' WHERE id = $1`, [importId]);
      await writeAuditLog({
        userId: req.user?.id,
        action: "IMPORT_FAIL",
        meta: { importId, type: "BASE", error: error instanceof Error ? error.message : "unknown" }
      });
      throw error;
    } finally {
      client.release();
    }
  }
);

importsRouter.get("/", authRequired, requireScreenAccess("imports"), async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ message: "Query inválida." });
  }

  const { page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;
  const result = await pool.query(
    `
      SELECT
        i.*,
        u.name AS imported_by_name
      FROM imports i
      LEFT JOIN users u ON u.id = i.imported_by_user_id
      ORDER BY imported_at DESC
      LIMIT $1 OFFSET $2
    `,
    [pageSize, offset]
  );

  return res.json({ items: result.rows, page, pageSize });
});

importsRouter.get("/:id", authRequired, requireScreenAccess("imports"), async (req, res) => {
  const result = await pool.query(`SELECT * FROM imports WHERE id = $1`, [req.params.id]);
  if (!result.rowCount) {
    return res.status(404).json({ message: "Import não encontrado." });
  }
  return res.json(result.rows[0]);
});

