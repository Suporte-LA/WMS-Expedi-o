import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import { authRequired, AuthenticatedRequest } from "../middleware/auth.js";
import { pool } from "../db.js";

const upload = multer({ storage: multer.memoryStorage() });

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

const baseImportSchema = z.object({
  sheetName: z.string().optional()
});

const historyImportSchema = z.object({
  sheetName: z.string().optional()
});

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");

const textLike = (value: unknown): string => (value == null ? "" : String(value).trim());

function pickField(row: Record<string, unknown>, aliases: string[]) {
  const map = new Map<string, unknown>();
  Object.keys(row).forEach((key) => map.set(normalizeHeader(key), row[key]));
  for (const alias of aliases) {
    const found = map.get(normalizeHeader(alias));
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseTiBase(buffer: Buffer, sheetName?: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows
    .map((row) => ({
      maintenanceItem: textLike(pickField(row, ["Manutencao", "Manutenção"])),
      name: textLike(pickField(row, ["Nome"])),
      operation: textLike(pickField(row, ["Operacao", "Operação"])),
      phoneModel: textLike(pickField(row, ["Celulares", "Celular", "Aparelho"])),
      tabletModel: textLike(pickField(row, ["Tablets", "Tablet"]))
    }))
    .filter((row) => row.name && row.operation);
}

function parseTimeUsage(buffer: Buffer, sheetName?: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet =
    (sheetName && workbook.Sheets[sheetName]) ||
    workbook.Sheets["Tempo de uso"] ||
    workbook.Sheets["Tempo de Uso"];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows
    .map((row) => ({
      item: textLike(pickField(row, ["Materiais", "Material", "Item"])),
      months: Number(textLike(pickField(row, ["Tempo Estimado Em Meses", "Tempo estimado em meses", "Meses"])))
    }))
    .filter((row) => row.item && Number.isFinite(row.months) && row.months > 0);
}

function parseUnifiedHistory(buffer: Buffer, sheetName?: string) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[sheetName || workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const isDateLike = (value: string) => {
    if (!value) return false;
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value)) return true;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  };
  return rows
    .map((row) => {
      const submittedAt =
        new Date(textLike(pickField(row, ["Data/Hora", "Data Hora", "Data", "Carimbo de data/hora"]))) || new Date();
      const operation = textLike(pickField(row, ["Cod Vendedor", "Codigo", "Cod", "Operacao", "Operação", "Nome"]));
      const name = textLike(pickField(row, ["Nome", "Nome.1"])) || operation;
      const tipo = textLike(pickField(row, ["Tipo"]));
      const trocado = textLike(pickField(row, ["Trocado"]));
      const maintenanceFromTipo = [tipo, trocado].filter(Boolean).join(" ").trim();
      const trocaField = textLike(pickField(row, ["Troca"]));
      let maintenanceItem =
        maintenanceFromTipo ||
        (isDateLike(trocaField) ? "" : trocaField) ||
        textLike(pickField(row, ["Tipo de Manutenção", "Manutencao", "Manutenção", "O que foi trocado"]));
      if (maintenanceItem && maintenanceItem.toLowerCase() === "nan") maintenanceItem = "";
      const model = textLike(pickField(row, ["Modelo", "Modelos"]));
      const model2 = textLike(pickField(row, ["Modelo 2", "Modelos 2", "Unnamed: 10", "Unnamed: 9"]));
      if (!operation || !maintenanceItem) return null;
      const key = maintenanceItem.toLowerCase();
      const tipoKey = tipo.toLowerCase();
      let phoneModel = "";
      let tabletModel = "";
      if (tipoKey.includes("tablet") || key.includes("tablet")) {
        tabletModel = model || model2;
      } else if (tipoKey.includes("celular") || key.includes("celular")) {
        phoneModel = model || model2;
      } else {
        phoneModel = model;
        tabletModel = model2;
      }
      return {
        submittedAt: submittedAt instanceof Date && !Number.isNaN(submittedAt.getTime()) ? submittedAt : new Date(),
        name,
        operation,
        maintenanceItem,
        phoneModel: phoneModel || null,
        tabletModel: tabletModel || null
      };
    })
    .filter(Boolean) as Array<{
      submittedAt: Date;
      name: string;
      operation: string;
      maintenanceItem: string;
      phoneModel: string | null;
      tabletModel: string | null;
    }>;
}
function resolveLimitKey(value: string): string {
  const key = value.toLowerCase();
  if (key.includes("pelicula")) return "pelicula";
  if (key.includes("película")) return "pelicula";
  if (key.includes("capinha")) return "capinha";
  if (key.includes("tablet")) return "tablet";
  if (key.includes("celular")) return "celular";
  return key.trim();
}

function requireTiAccess(req: AuthenticatedRequest): boolean {
  if (!req.user) return false;
  if (req.user.role === "admin") return true;
  return req.user.workspace === "ti";
}

export const tiRouter = Router();

tiRouter.post("/catalog/import", authRequired, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  if (!req.file) return res.status(400).json({ message: "Arquivo obrigatorio." });

  const parsed = baseImportSchema.safeParse(req.body);
  const sheetName = parsed.success ? parsed.data.sheetName : undefined;
  const baseRows = parseTiBase(req.file.buffer, sheetName);
  const timeRows = parseTimeUsage(req.file.buffer);

  if (!baseRows.length && !timeRows.length) {
    return res.status(400).json({ message: "Nao encontramos linhas validas para importar." });
  }

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let limitsUpdated = 0;
  try {
    await client.query("BEGIN");
    for (const row of baseRows) {
      const existing = await client.query(
        `
          SELECT id
          FROM ti_device_catalog
          WHERE name = $1 AND operation = $2
          LIMIT 1
        `,
        [row.name, row.operation]
      );

      if (existing.rowCount) {
        await client.query(
          `
            UPDATE ti_device_catalog
            SET phone_model = $3,
                tablet_model = $4,
                updated_at = now()
            WHERE id = $1
          `,
          [existing.rows[0].id, row.phoneModel || null, row.tabletModel || null]
        );
        updated += 1;
      } else {
        await client.query(
          `
            INSERT INTO ti_device_catalog (name, operation, phone_model, tablet_model)
            VALUES ($1, $2, $3, $4)
          `,
          [row.name, row.operation, row.phoneModel || null, row.tabletModel || null]
        );
        inserted += 1;
      }
    }

    for (const row of timeRows) {
      await client.query(
        `
          INSERT INTO ti_device_limits (item, months_limit, max_count)
          VALUES ($1, $2, COALESCE((SELECT max_count FROM ti_device_limits WHERE item = $1), 1))
          ON CONFLICT (item) DO UPDATE SET months_limit = EXCLUDED.months_limit
        `,
        [row.item.toLowerCase(), row.months]
      );
      limitsUpdated += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return res.status(201).json({
    summary: {
      processedRows: baseRows.length,
      insertedRows: inserted,
      updatedRows: updated,
      limitsUpdated
    }
  });
});

tiRouter.post("/history/import", authRequired, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  if (!req.file) return res.status(400).json({ message: "Arquivo obrigatorio." });

  const parsed = historyImportSchema.safeParse(req.body);
  const sheetName = parsed.success ? parsed.data.sheetName : undefined;
  const rows = parseUnifiedHistory(req.file.buffer, sheetName);
  if (!rows.length) return res.status(400).json({ message: "Nao encontramos linhas validas para importar." });

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const result = await client.query(
        `
          INSERT INTO ti_device_records (
            submitted_at,
            maintenance_item,
            name,
            operation,
            phone_model,
            tablet_model
          )
          SELECT $1, $2, $3, $4, $5, $6
          WHERE NOT EXISTS (
            SELECT 1
            FROM ti_device_records
            WHERE submitted_at = $1
              AND maintenance_item = $2
              AND name = $3
              AND operation = $4
              AND COALESCE(phone_model, '') = COALESCE($5, '')
              AND COALESCE(tablet_model, '') = COALESCE($6, '')
          )
        `,
        [row.submittedAt, row.maintenanceItem, row.name, row.operation, row.phoneModel, row.tabletModel]
      );
      if ((result.rowCount ?? 0) > 0) inserted += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return res.status(201).json({ summary: { processedRows: rows.length, insertedRows: inserted } });
});

tiRouter.get("/catalog/options", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });

  const [catalog, limits, items] = await Promise.all([
    pool.query(
      `
        SELECT id, name, operation, phone_model, tablet_model
        FROM ti_device_catalog
        ORDER BY name
      `
    ),
    pool.query(`SELECT item, months_limit, max_count FROM ti_device_limits ORDER BY item`),
    pool.query(`SELECT DISTINCT maintenance_item FROM ti_device_records ORDER BY maintenance_item`)
  ]);

  const maintenanceItems = new Set<string>();
  for (const row of limits.rows) maintenanceItems.add(String(row.item));
  for (const row of items.rows) maintenanceItems.add(String(row.maintenance_item));

  return res.json({
    catalog: catalog.rows,
    maintenanceItems: Array.from(maintenanceItems)
  });
});

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

  const limits = await pool.query(
    `
      SELECT item, months_limit, max_count
      FROM ti_device_limits
    `
  );
  const limitMap = new Map<string, { months: number; max: number }>();
  let maxMonths = 6;
  for (const row of limits.rows) {
    const months = Number(row.months_limit);
    const max = Number(row.max_count);
    limitMap.set(String(row.item).toLowerCase(), { months, max });
    if (months > maxMonths) maxMonths = months;
  }

  const baseFilters: string[] = [];
  const baseValues: unknown[] = [];
  if (name?.trim()) {
    baseValues.push(`%${name.trim()}%`);
    baseFilters.push(`r.name ILIKE $${baseValues.length}`);
  }
  if (operation?.trim()) {
    baseValues.push(`%${operation.trim()}%`);
    baseFilters.push(`r.operation ILIKE $${baseValues.length}`);
  }
  if (item?.trim()) {
    baseValues.push(`%${item.trim()}%`);
    baseFilters.push(`r.maintenance_item ILIKE $${baseValues.length}`);
  }
  baseValues.push(refDate);
  baseValues.push(maxMonths);
  const baseWhere = baseFilters.length ? `WHERE ${baseFilters.join(" AND ")} AND` : "WHERE";

  const windowed = await pool.query(
    `
      SELECT
        r.name,
        r.operation,
        r.maintenance_item,
        r.submitted_at
      FROM ti_device_records r
      ${baseWhere} r.submitted_at >= ($${baseValues.length - 1}::date - ($${baseValues.length}::int || ' months')::interval)
        AND r.submitted_at::date <= $${baseValues.length - 1}::date
      ORDER BY r.submitted_at DESC
    `,
    baseValues
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
    values
  );

  const ref = new Date(refDate);
  const minStart = from ? new Date(from) : null;
  const grouped = new Map<string, { name: string; operation: string; item: string; dates: Date[] }>();
  for (const row of windowed.rows as Array<{ name: string; operation: string; maintenance_item: string; submitted_at: string }>) {
    const key = `${row.name}||${row.operation}||${row.maintenance_item}`;
    const bucket = grouped.get(key) || { name: row.name, operation: row.operation, item: row.maintenance_item, dates: [] };
    bucket.dates.push(new Date(row.submitted_at));
    grouped.set(key, bucket);
  }

  const limitRows = Array.from(grouped.values()).map((row) => {
    const key = resolveLimitKey(String(row.item || ""));
    const limit = limitMap.get(key) || { months: 6, max: 1 };
    const start = new Date(ref);
    start.setMonth(start.getMonth() - limit.months);
    const effectiveStart = minStart && minStart > start ? minStart : start;
    const count = row.dates.filter((d) => d >= effectiveStart && d <= ref).length;
    return {
      name: row.name,
      operation: row.operation,
      maintenance_item: row.item,
      total_count: count,
      last_date: row.dates[0],
      months_limit: limit.months,
      max_count: limit.max,
      status: count > limit.max ? "fora_do_limite" : "dentro_do_limite"
    };
  });

  limitRows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "fora_do_limite" ? -1 : 1;
    const op = String(a.operation).localeCompare(String(b.operation));
    if (op !== 0) return op;
    const nameCmp = String(a.name).localeCompare(String(b.name));
    if (nameCmp !== 0) return nameCmp;
    return String(a.maintenance_item).localeCompare(String(b.maintenance_item));
  });

  return res.json({
    reference_date: refDate,
    limits: limitRows,
    monthly: monthSummary.rows
  });
});

