import { Router } from "express";
import type { PoolClient } from "pg";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage() });

const baseListSchema = z.object({
  supplier: z.string().optional(),
  street: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100)
});

const recordsListSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  operator: z.string().optional(),
  activity: z.enum(["validade", "abastecimento"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const dashboardSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional()
});

const replenishmentSchema = z.object({
  scannedCode: z.string().min(1, "Codigo Produto obrigatorio."),
  workDate: z.string().min(1, "Data obrigatoria."),
  entryTime: z.string().optional(),
  quantity1: z.coerce.number().positive("Quantidade 1 deve ser maior que zero."),
  expiry1: z.string().min(1, "Validade 1 obrigatoria."),
  quantity2: z.coerce.number().positive().optional(),
  expiry2: z.string().optional()
});

const expirationSchema = z.object({
  scannedCode: z.string().min(1, "Codigo Produto obrigatorio."),
  workDate: z.string().min(1, "Data obrigatoria."),
  quantity: z.coerce.number().positive("Quantidade deve ser maior que zero."),
  expiryDate: z.string().min(1, "Validade obrigatoria."),
  local: z.string().min(1, "Local obrigatorio."),
  street: z.string().min(1, "Rua obrigatoria.")
});

const allocationListSchema = z.object({
  search: z.string().optional(),
  palletCode: z.string().optional(),
  mode: z.enum(["single", "pallet"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const allocationSaveSchema = z.object({
  mode: z.enum(["single", "pallet"]).default("single"),
  items: z
    .array(
      z.object({
        productCode: z.string().min(1, "Produto obrigatorio."),
        quantity: z.coerce.number().positive("Quantidade deve ser maior que zero.")
      })
    )
    .min(1, "Selecione pelo menos um produto."),
  shed: z.string().min(1, "Galpao obrigatorio."),
  street: z.string().min(1, "Rua obrigatoria."),
  building: z.string().min(1, "Predio obrigatorio."),
  apartment: z.string().min(1, "Apartamento obrigatorio."),
  palletPosition: z.string().min(1, "Posicao no pallet obrigatoria."),
  palletCode: z.string().optional(),
  notes: z.string().optional()
});

const allocationUpdateSchema = allocationSaveSchema.extend({
  mode: z.enum(["single", "pallet"]).optional(),
  items: allocationSaveSchema.shape.items.optional()
});

const textLike = (value: unknown): string => (value == null ? "" : String(value).trim());

const normalizeHeader = (header: string) =>
  header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function pickField(row: Record<string, unknown>, aliases: string[]) {
  const map = new Map<string, unknown>();
  Object.keys(row).forEach((key) => map.set(normalizeHeader(key), row[key]));
  for (const alias of aliases) {
    const found = map.get(normalizeHeader(alias));
    if (found !== undefined) return found;
  }
  return undefined;
}

function digitsOnly(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function looksLikeBarcode(value: string | null) {
  const digits = digitsOnly(value || "");
  return digits.length >= 8;
}

function looksLikeShortCode(value: string | null) {
  const digits = digitsOnly(value || "");
  return digits.length > 0 && digits.length <= 6;
}

function padSegment(value: string, size: number) {
  const digits = digitsOnly(value);
  if (!digits) return "".padStart(size, "0");
  return digits.padStart(size, "0").slice(-size);
}

function buildAllocationPosition(input: {
  shed: string;
  street: string;
  building: string;
  apartment: string;
  palletPosition: string;
}) {
  const shed = padSegment(input.shed, 1);
  const street = padSegment(input.street, 2);
  const building = padSegment(input.building, 2);
  const apartment = padSegment(input.apartment, 2);
  const palletPosition = padSegment(input.palletPosition, 2);
  const positionCode = `${shed}${street}${building}${apartment}${palletPosition}`;
  const positionLabel = `Galpao ${shed} | Rua ${street} | Predio ${building} | Apartamento ${apartment} | Posicao ${palletPosition}`;
  return { shed, street, building, apartment, palletPosition, positionCode, positionLabel };
}

type ImportedBaseProduct = {
  productCode: string;
  description: string;
  barcode: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  local: string | null;
  street: string | null;
};

function parseStockBase(buffer: Buffer): ImportedBaseProduct[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return rows
    .map((row) => {
      const productCode = textLike(pickField(row, ["Codigo Produto", "Cod Produto", "Produto"]));
      const description = textLike(pickField(row, ["Descricao", "Descricao Produto", "Produto Descricao"]));
      const rawBarcode = textLike(pickField(row, ["Codigo Barras", "Cod Barras", "Codigo de Barras", "EAN"]));
      const rawSupplierCode = textLike(pickField(row, ["Cod Forn", "Cod Forn.", "Cod Fornecedor"]));
      const supplierName = textLike(pickField(row, ["Fornecedor", "Descricao Fornecedor"]));
      const local = textLike(pickField(row, ["Local"]));
      const street = textLike(pickField(row, ["Rua", "Posicao", "Posicao Produto"]));

      let barcode = rawBarcode || null;
      let supplierCode = rawSupplierCode || null;

      // Algumas planilhas do estoque vêm com os valores de "Código Barras" e
      // "Cód Forn." invertidos no conteúdo. Quando detectamos um EAN longo no
      // campo do fornecedor e um código curto no campo de barras, corrigimos.
      if (looksLikeShortCode(rawBarcode) && looksLikeBarcode(rawSupplierCode)) {
        barcode = rawSupplierCode;
        supplierCode = rawBarcode || null;
      }

      return {
        productCode,
        description,
        barcode,
        supplierCode,
        supplierName: supplierName || null,
        local: local || null,
        street: street || null
      };
    })
    .filter((row) => row.productCode && row.description);
}

async function findBaseProduct(ref: string) {
  const cleaned = ref.trim();
  if (!cleaned) return null;

  const result = await pool.query(
    `
      SELECT *
      FROM stock_base_products
      WHERE product_code = $1
         OR barcode = $1
         OR regexp_replace(COALESCE(product_code, ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
         OR regexp_replace(COALESCE(barcode, ''), '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [cleaned]
  );

  return result.rows[0] || null;
}

async function findLatestAllocationsByProductCodes(productCodes: string[]) {
  if (!productCodes.length) return new Map<string, any>();
  const result = await pool.query(
    `
      SELECT DISTINCT ON (product_code)
        product_code,
        position_code,
        position_label,
        pallet_code
      FROM stock_allocations
      WHERE product_code = ANY($1::text[])
      ORDER BY product_code, updated_at DESC, created_at DESC
    `,
    [productCodes]
  );

  return new Map(result.rows.map((row) => [row.product_code, row]));
}

async function findExpirationContext(productCode: string) {
  const latestLocation = await pool.query(
    `
      SELECT local, street
      FROM stock_expirations
      WHERE product_code = $1
      ORDER BY work_date DESC, created_at DESC
      LIMIT 1
    `,
    [productCode]
  );

  const expiries = await pool.query(
    `
      SELECT quantity, expiry_date
      FROM stock_expirations
      WHERE product_code = $1
      ORDER BY expiry_date ASC NULLS LAST, created_at DESC
      LIMIT 2
    `,
    [productCode]
  );

  return {
    local: latestLocation.rows[0]?.local || null,
    street: latestLocation.rows[0]?.street || null,
    expiries: expiries.rows
  };
}

async function allocateLots(
  client: PoolClient,
  productCode: string,
  requestedQuantity: number,
  preferredExpiry?: string | null
) {
  let remaining = requestedQuantity;

  const values: unknown[] = [productCode];
  let orderBy = "ORDER BY expiry_date ASC, created_at ASC";
  if (preferredExpiry) {
    values.push(preferredExpiry);
    orderBy = `
      ORDER BY
        CASE WHEN expiry_date = $2::date THEN 0 ELSE 1 END,
        expiry_date ASC,
        created_at ASC
    `;
  }

  const lots = await client.query(
    `
      SELECT *
      FROM stock_inventory_lots
      WHERE product_code = $1
        AND quantity_remaining > 0
      ${orderBy}
    `,
    values
  );

  const allocations: Array<{
    lotId: string;
    quantity: number;
    expiryDate: string | null;
    local: string | null;
    street: string | null;
  }> = [];

  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const available = Number(lot.quantity_remaining || 0);
    if (available <= 0) continue;

    const consumed = Math.min(available, remaining);
    await client.query(
      `
        UPDATE stock_inventory_lots
        SET quantity_remaining = quantity_remaining - $2,
            updated_at = now()
        WHERE id = $1
      `,
      [lot.id, consumed]
    );

    allocations.push({
      lotId: lot.id,
      quantity: consumed,
      expiryDate: lot.expiry_date || null,
      local: lot.local || null,
      street: lot.street || null
    });
    remaining -= consumed;
  }

  if (remaining > 0) {
    throw new Error("Estoque insuficiente para atender o abastecimento pela validade mais baixa.");
  }

  return allocations;
}

export const stockRouter = Router();

stockRouter.get("/base", authRequired, async (req, res) => {
  const parsed = baseListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { supplier, street, search, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (supplier?.trim()) {
    values.push(`%${supplier.trim()}%`);
    filters.push(`supplier_name ILIKE $${values.length}`);
  }

  if (street?.trim()) {
    values.push(`%${street.trim()}%`);
    filters.push(`street ILIKE $${values.length}`);
  }

  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(
      product_code ILIKE $${values.length}
      OR barcode ILIKE $${values.length}
      OR description ILIKE $${values.length}
      OR supplier_name ILIKE $${values.length}
      OR supplier_code ILIKE $${values.length}
      OR local ILIKE $${values.length}
      OR street ILIKE $${values.length}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const [items, countRes, suppliers] = await Promise.all([
    pool.query(
      `
        SELECT *
        FROM stock_base_products
        ${where}
        ORDER BY
          CASE
            WHEN lower(product_code) LIKE 'vendas%' THEN 0
            WHEN lower(product_code) LIKE 'cg%' THEN 1
            ELSE 2
          END,
          COALESCE(supplier_name, '') ASC,
          COALESCE(description, '') ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM stock_base_products ${where}`, values),
    pool.query(
      `
        SELECT DISTINCT supplier_name
        FROM stock_base_products
        WHERE supplier_name IS NOT NULL
          AND supplier_name <> ''
        ORDER BY supplier_name
      `
    )
  ]);

  const allocationMap = await findLatestAllocationsByProductCodes(items.rows.map((row) => row.product_code));
  const mergedItems = items.rows.map((row) => {
    const allocation = allocationMap.get(row.product_code);
    return {
      ...row,
      allocation_position_code: allocation?.position_code || null,
      allocation_position_label: allocation?.position_label || null,
      allocation_pallet_code: allocation?.pallet_code || null
    };
  });

  return res.json({
    items: mergedItems,
    suppliers: suppliers.rows.map((row) => row.supplier_name),
    page,
    pageSize,
    total: countRes.rows[0]?.total || 0
  });
});

stockRouter.get("/lookup/:value", authRequired, async (req, res) => {
  const ref = String(req.params.value || "").trim();
  if (!ref) return res.status(400).json({ message: "Referencia invalida." });

  const found = await findBaseProduct(ref);
  if (!found) {
    return res.status(404).json({ message: "Produto nao encontrado na base de estoque." });
  }

  const expirationContext = await findExpirationContext(found.product_code);
  const allocationsRes = await pool.query(
    `
      SELECT *
      FROM stock_allocations
      WHERE product_code = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 20
    `,
    [found.product_code]
  );

  return res.json({
    product: {
      ...found,
      allocation_position_code: allocationsRes.rows[0]?.position_code || null,
      allocation_position_label: allocationsRes.rows[0]?.position_label || null,
      allocation_pallet_code: allocationsRes.rows[0]?.pallet_code || null
    },
    expirationContext,
    allocations: allocationsRes.rows
  });
});

stockRouter.get("/dashboard", authRequired, async (req, res) => {
  const parsed = dashboardSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const from = parsed.data.from || "1900-01-01";
  const to = parsed.data.to || "2999-12-31";

  const [cardsRes, trendRes, operatorRes, activityRes] = await Promise.all([
    pool.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN movement_type = 'entry' THEN quantity ELSE 0 END), 0)::float AS total_entries,
          COALESCE(SUM(CASE WHEN movement_type = 'exit' THEN quantity ELSE 0 END), 0)::float AS total_exits,
          COUNT(DISTINCT product_code)::int AS total_skus,
          COUNT(DISTINCT operator_name)::int AS total_operators
        FROM stock_activity_logs
        WHERE work_date BETWEEN $1 AND $2
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT
          work_date,
          COALESCE(SUM(CASE WHEN movement_type = 'entry' THEN quantity ELSE 0 END), 0)::float AS entries,
          COALESCE(SUM(CASE WHEN movement_type = 'exit' THEN quantity ELSE 0 END), 0)::float AS exits
        FROM stock_activity_logs
        WHERE work_date BETWEEN $1 AND $2
        GROUP BY work_date
        ORDER BY work_date
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT
          COALESCE(operator_name, 'Sem operador') AS operator_name,
          COALESCE(SUM(quantity), 0)::float AS total_quantity,
          COUNT(*)::int AS total_activities
        FROM stock_activity_logs
        WHERE work_date BETWEEN $1 AND $2
        GROUP BY COALESCE(operator_name, 'Sem operador')
        ORDER BY total_quantity DESC, total_activities DESC
        LIMIT 10
      `,
      [from, to]
    ),
    pool.query(
      `
        SELECT
          CASE
            WHEN activity_type = 'validade' THEN 'Entrada por Validade'
            WHEN activity_type = 'abastecimento' THEN 'Saida por Abastecimento'
            ELSE activity_type
          END AS label,
          COALESCE(SUM(quantity), 0)::float AS total_quantity
        FROM stock_activity_logs
        WHERE work_date BETWEEN $1 AND $2
        GROUP BY label
        ORDER BY total_quantity DESC
      `,
      [from, to]
    )
  ]);

  return res.json({
    cards: cardsRes.rows[0] || {
      total_entries: 0,
      total_exits: 0,
      total_skus: 0,
      total_operators: 0
    },
    trend: trendRes.rows,
    byOperator: operatorRes.rows,
    byActivity: activityRes.rows
  });
});

stockRouter.get("/activity", authRequired, async (req, res) => {
  const parsed = recordsListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, search, operator, activity, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`work_date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    filters.push(`work_date <= $${values.length}`);
  }
  if (operator?.trim()) {
    values.push(`%${operator.trim()}%`);
    filters.push(`operator_name ILIKE $${values.length}`);
  }
  if (activity) {
    values.push(activity);
    filters.push(`activity_type = $${values.length}`);
  }
  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(
      product_code ILIKE $${values.length}
      OR barcode ILIKE $${values.length}
      OR description ILIKE $${values.length}
      OR operator_name ILIKE $${values.length}
      OR supplier_name ILIKE $${values.length}
      OR local ILIKE $${values.length}
      OR street ILIKE $${values.length}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;
  const result = await pool.query(
    `
      SELECT *
      FROM stock_activity_logs
      ${where}
      ORDER BY work_date DESC, created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, pageSize, offset]
  );

  return res.json({ items: result.rows, page, pageSize });
});

stockRouter.get("/imports", authRequired, async (_req, res) => {
  const result = await pool.query(
    `
      SELECT *
      FROM stock_base_imports
      ORDER BY created_at DESC
      LIMIT 20
    `
  );
  return res.json({ items: result.rows });
});

stockRouter.post("/import-base", authRequired, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ message: "Arquivo da base do estoque obrigatorio." });
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

  const rows = parseStockBase(req.file.buffer);
  if (!rows.length) {
    return res.status(400).json({
      message:
        "Nao encontramos linhas validas. Cabecalhos esperados: Codigo Produto, Descricao, Codigo Barras, Cod Forn., Fornecedor, Local, Rua."
    });
  }

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");

    for (const row of rows) {
      const existing = await client.query(
        `SELECT id FROM stock_base_products WHERE product_code = $1 LIMIT 1`,
        [row.productCode]
      );

      if (existing.rowCount) {
        await client.query(
          `
            UPDATE stock_base_products
            SET
              description = $2,
              barcode = $3,
              supplier_code = $4,
              supplier_name = $5,
              local = $6,
              street = $7,
              updated_at = now()
            WHERE product_code = $1
          `,
          [row.productCode, row.description, row.barcode, row.supplierCode, row.supplierName, row.local, row.street]
        );
        updated += 1;
      } else {
        await client.query(
          `
            INSERT INTO stock_base_products (
              product_code, description, barcode, supplier_code, supplier_name, local, street
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [row.productCode, row.description, row.barcode, row.supplierCode, row.supplierName, row.local, row.street]
        );
        inserted += 1;
      }
    }

    await client.query(
      `
        INSERT INTO stock_base_imports (
          filename, processed_rows, inserted_rows, updated_rows, imported_by_user_id, imported_by_name
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [req.file.originalname, rows.length, inserted, updated, req.user.id, req.user.name]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return res.status(201).json({
    summary: {
      processedRows: rows.length,
      insertedRows: inserted,
      updatedRows: updated
    }
  });
});

stockRouter.get("/replenishments", authRequired, async (req, res) => {
  const parsed = recordsListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, search, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`work_date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    filters.push(`work_date <= $${values.length}`);
  }
  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(
      product_code ILIKE $${values.length}
      OR barcode ILIKE $${values.length}
      OR description ILIKE $${values.length}
      OR user_name ILIKE $${values.length}
      OR supplier_name ILIKE $${values.length}
      OR local ILIKE $${values.length}
      OR street ILIKE $${values.length}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const result = await pool.query(
    `
      SELECT *
      FROM stock_replenishments
      ${where}
      ORDER BY work_date DESC, entry_time DESC NULLS LAST, created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, pageSize, offset]
  );

  return res.json({ items: result.rows, page, pageSize });
});

stockRouter.post("/replenishments", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });
  const parsed = replenishmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Payload invalido." });
  }

  const { scannedCode, workDate, entryTime, quantity1, expiry1, quantity2, expiry2 } = parsed.data;
  const base = await findBaseProduct(scannedCode);
  if (!base) {
    return res.status(404).json({ message: "Produto nao encontrado na base do estoque." });
  }
  const expirationContext = await findExpirationContext(base.product_code);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const firstAllocations = await allocateLots(client, base.product_code, quantity1, expiry1 || null);
    const secondAllocations =
      quantity2 && Number(quantity2) > 0 ? await allocateLots(client, base.product_code, Number(quantity2), expiry2 || null) : [];

    const result = await client.query(
      `
        INSERT INTO stock_replenishments (
          work_date, entry_time, product_code, description, barcode, supplier_code, supplier_name,
          quantity_1, expiry_1, quantity_2, expiry_2, user_name, local, street
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `,
      [
        workDate,
        entryTime || null,
        base.product_code,
        base.description,
        base.barcode,
        base.supplier_code,
        base.supplier_name,
        quantity1,
        firstAllocations[0]?.expiryDate || expiry1,
        quantity2 || null,
        secondAllocations[0]?.expiryDate || expiry2 || null,
        req.user.name,
        expirationContext.local,
        expirationContext.street
      ]
    );

    for (const allocation of [...firstAllocations, ...secondAllocations]) {
      await client.query(
        `
          INSERT INTO stock_activity_logs (
            work_date, movement_type, activity_type, product_code, description, barcode,
            supplier_code, supplier_name, local, street, expiry_date, quantity,
            operator_name, related_record_id, lot_id
          )
          VALUES ($1, 'exit', 'abastecimento', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          workDate,
          base.product_code,
          base.description,
          base.barcode,
          base.supplier_code,
          base.supplier_name,
          allocation.local || expirationContext.local,
          allocation.street || expirationContext.street,
          allocation.expiryDate,
          allocation.quantity,
          req.user.name,
          result.rows[0].id,
          allocation.lotId
        ]
      );
    }

    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ message: error?.message || "Falha ao registrar abastecimento." });
  } finally {
    client.release();
  }
});

stockRouter.get("/expirations", authRequired, async (req, res) => {
  const parsed = recordsListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, search, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(from);
    filters.push(`work_date >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    filters.push(`work_date <= $${values.length}`);
  }
  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(
      product_code ILIKE $${values.length}
      OR barcode ILIKE $${values.length}
      OR description ILIKE $${values.length}
      OR user_name ILIKE $${values.length}
      OR supplier_name ILIKE $${values.length}
      OR local ILIKE $${values.length}
      OR street ILIKE $${values.length}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const result = await pool.query(
    `
      SELECT *
      FROM stock_expirations
      ${where}
      ORDER BY work_date DESC, created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, pageSize, offset]
  );

  return res.json({ items: result.rows, page, pageSize });
});

stockRouter.post("/expirations", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });
  const parsed = expirationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Payload invalido." });
  }

  const { scannedCode, workDate, quantity, expiryDate, local, street } = parsed.data;
  const base = await findBaseProduct(scannedCode);
  if (!base) {
    return res.status(404).json({ message: "Produto nao encontrado na base do estoque." });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        INSERT INTO stock_expirations (
          work_date, product_code, description, barcode, supplier_code, supplier_name,
          quantity, expiry_date, user_name, local, street
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        workDate,
        base.product_code,
        base.description,
        base.barcode,
        base.supplier_code,
        base.supplier_name,
        quantity,
        expiryDate,
        req.user.name,
        local,
        street
      ]
    );

    const lot = await client.query(
      `
        INSERT INTO stock_inventory_lots (
          product_code, description, barcode, supplier_code, supplier_name, local, street,
          expiry_date, quantity_initial, quantity_remaining, source_type, source_id, created_by_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 'validade', $10, $11)
        RETURNING *
      `,
      [
        base.product_code,
        base.description,
        base.barcode,
        base.supplier_code,
        base.supplier_name,
        local,
        street,
        expiryDate,
        quantity,
        result.rows[0].id,
        req.user.name
      ]
    );

    await client.query(
      `
        INSERT INTO stock_activity_logs (
          work_date, movement_type, activity_type, product_code, description, barcode,
          supplier_code, supplier_name, local, street, expiry_date, quantity,
          operator_name, related_record_id, lot_id
        )
        VALUES ($1, 'entry', 'validade', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        workDate,
        base.product_code,
        base.description,
        base.barcode,
        base.supplier_code,
        base.supplier_name,
        local,
        street,
        expiryDate,
        quantity,
        req.user.name,
        result.rows[0].id,
        lot.rows[0].id
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

stockRouter.get("/allocations", authRequired, async (req, res) => {
  const parsed = allocationListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { search, palletCode, mode, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(
      product_code ILIKE $${values.length}
      OR description ILIKE $${values.length}
      OR barcode ILIKE $${values.length}
      OR supplier_name ILIKE $${values.length}
      OR position_code ILIKE $${values.length}
      OR position_label ILIKE $${values.length}
      OR COALESCE(pallet_code, '') ILIKE $${values.length}
    )`);
  }

  if (palletCode?.trim()) {
    values.push(`%${palletCode.trim()}%`);
    filters.push(`COALESCE(pallet_code, '') ILIKE $${values.length}`);
  }

  if (mode) {
    values.push(mode);
    filters.push(`allocation_mode = $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const [itemsRes, logsRes] = await Promise.all([
    pool.query(
      `
        SELECT *
        FROM stock_allocations
        ${where}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset]
    ),
    pool.query(
      `
        SELECT *
        FROM stock_allocation_logs
        ORDER BY created_at DESC
        LIMIT 50
      `
    )
  ]);

  return res.json({
    items: itemsRes.rows,
    logs: logsRes.rows,
    page,
    pageSize
  });
});

stockRouter.post("/allocations", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });
  const parsed = allocationSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Payload invalido." });
  }

  const payload = parsed.data;
  const position = buildAllocationPosition(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const createdRows: any[] = [];

    for (const item of payload.items) {
      const base = await findBaseProduct(item.productCode);
      if (!base) {
        throw new Error(`Produto ${item.productCode} nao encontrado na base do estoque.`);
      }

      const inserted = await client.query(
        `
          INSERT INTO stock_allocations (
            product_code, description, barcode, supplier_code, supplier_name, quantity,
            shed, street, building, apartment, pallet_position,
            position_code, position_label, pallet_code, allocation_mode, operator_name, notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING *
        `,
        [
          base.product_code,
          base.description,
          base.barcode,
          base.supplier_code,
          base.supplier_name,
          item.quantity,
          position.shed,
          position.street,
          position.building,
          position.apartment,
          position.palletPosition,
          position.positionCode,
          position.positionLabel,
          payload.palletCode?.trim() || null,
          payload.mode,
          req.user.name,
          payload.notes?.trim() || null
        ]
      );

      await client.query(
        `
          INSERT INTO stock_allocation_logs (
            allocation_id, action_type, product_code, description, quantity,
            new_position_code, new_position_label, pallet_code, operator_name, notes
          )
          VALUES ($1, 'create', $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          inserted.rows[0].id,
          base.product_code,
          base.description,
          item.quantity,
          position.positionCode,
          position.positionLabel,
          payload.palletCode?.trim() || null,
          req.user.name,
          payload.notes?.trim() || null
        ]
      );

      createdRows.push(inserted.rows[0]);
    }

    await client.query("COMMIT");
    return res.status(201).json({ items: createdRows });
  } catch (error: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ message: error?.message || "Falha ao registrar alocacao." });
  } finally {
    client.release();
  }
});

stockRouter.patch("/allocations/:id", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });
  const parsed = allocationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Payload invalido." });
  }

  const existingRes = await pool.query(`SELECT * FROM stock_allocations WHERE id = $1 LIMIT 1`, [req.params.id]);
  const existing = existingRes.rows[0];
  if (!existing) return res.status(404).json({ message: "Alocacao nao encontrada." });

  const payload = parsed.data;
  const position = buildAllocationPosition({
    shed: payload.shed,
    street: payload.street,
    building: payload.building,
    apartment: payload.apartment,
    palletPosition: payload.palletPosition
  });
  const firstItem = payload.items?.[0];
  const quantity = firstItem?.quantity ?? Number(existing.quantity);
  const productCode = firstItem?.productCode || existing.product_code;
  const base = await findBaseProduct(productCode);
  if (!base) return res.status(404).json({ message: "Produto nao encontrado na base do estoque." });

  const actionType =
    existing.position_code !== position.positionCode || existing.position_label !== position.positionLabel ? "move" : "update";

  const updated = await pool.query(
    `
      UPDATE stock_allocations
      SET
        product_code = $2,
        description = $3,
        barcode = $4,
        supplier_code = $5,
        supplier_name = $6,
        quantity = $7,
        shed = $8,
        street = $9,
        building = $10,
        apartment = $11,
        pallet_position = $12,
        position_code = $13,
        position_label = $14,
        pallet_code = $15,
        allocation_mode = $16,
        operator_name = $17,
        notes = $18,
        updated_at = now()
      WHERE id = $1
      RETURNING *
    `,
    [
      req.params.id,
      base.product_code,
      base.description,
      base.barcode,
      base.supplier_code,
      base.supplier_name,
      quantity,
      position.shed,
      position.street,
      position.building,
      position.apartment,
      position.palletPosition,
      position.positionCode,
      position.positionLabel,
      payload.palletCode?.trim() || existing.pallet_code || null,
      payload.mode || existing.allocation_mode,
      req.user.name,
      payload.notes?.trim() || existing.notes || null
    ]
  );

  await pool.query(
    `
      INSERT INTO stock_allocation_logs (
        allocation_id, action_type, product_code, description, quantity,
        previous_position_code, previous_position_label,
        new_position_code, new_position_label, pallet_code, operator_name, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      req.params.id,
      actionType,
      base.product_code,
      base.description,
      quantity,
      existing.position_code,
      existing.position_label,
      position.positionCode,
      position.positionLabel,
      payload.palletCode?.trim() || existing.pallet_code || null,
      req.user.name,
      payload.notes?.trim() || existing.notes || null
    ]
  );

  return res.json(updated.rows[0]);
});
