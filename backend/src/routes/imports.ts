import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest, requireRole } from "../middleware/auth.js";
import { writeAuditLog } from "../services/audit.js";
import { parseKpiFile, parseOrderCatalogFile } from "../services/importParser.js";

const upload = multer({ storage: multer.memoryStorage() });
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const importsRouter = Router();

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
  requireRole(["admin"]),
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
  authRequired,
  requireRole(["admin"]),
  upload.single("file"),
  async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Arquivo XLSX obrigatorio." });
    }

    const lower = req.file.originalname.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return res.status(400).json({ message: "Use apenas arquivo XLSX/XLS para base." });
    }

    const rows = parseOrderCatalogFile({
      filename: req.file.originalname,
      fileBuffer: req.file.buffer
    });

    if (!rows.length) {
      return res.status(400).json({ message: "Nenhuma linha valida da aba Base foi encontrada no arquivo." });
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
      [req.file.originalname, "base-import", JSON.stringify({ type: "BASE" }), req.user?.id]
    );
    const importId = importInsert.rows[0].id as string;

    await writeAuditLog({
      userId: req.user?.id,
      action: "IMPORT_CREATE",
      meta: { importId, filename: req.file.originalname, type: "BASE" }
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const summary = await insertOnlyOrderCatalogRows(rows, importId, client);
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
        [importId, rows.length, summary.inserted, summary.updated, JSON.stringify({ type: "BASE" })]
      );
      await client.query("COMMIT");

      await writeAuditLog({
        userId: req.user?.id,
        action: "IMPORT_SUCCESS",
        meta: { importId, type: "BASE", processed: rows.length, ...summary, consolidatedDescents }
      });

      return res.status(201).json({
        importId,
        summary: {
          processedRows: rows.length,
          insertedRows: summary.inserted,
          updatedRows: summary.updated,
          rejectedRows: 0,
          skippedRows: summary.skipped,
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

importsRouter.get("/", authRequired, requireRole(["admin"]), async (req, res) => {
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

importsRouter.get("/:id", authRequired, requireRole(["admin"]), async (req, res) => {
  const result = await pool.query(`SELECT * FROM imports WHERE id = $1`, [req.params.id]);
  if (!result.rowCount) {
    return res.status(404).json({ message: "Import não encontrado." });
  }
  return res.json(result.rows[0]);
});
