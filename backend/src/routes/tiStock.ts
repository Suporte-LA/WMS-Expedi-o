import { Router } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage() });

const movementSchema = z.object({
  productRef: z.string().min(1),
  movementType: z.enum(["entry", "exit", "return"]),
  quantity: z.coerce.number().positive(),
  notes: z.string().optional()
});

const listSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30)
});

const numberLike = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const textLike = (value: unknown): string => (value == null ? "" : String(value).trim());

const normalizeHeader = (header: string) =>
  header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");

function pickField(row: Record<string, unknown>, aliases: string[]) {
  const map = new Map<string, unknown>();
  Object.keys(row).forEach((key) => map.set(normalizeHeader(key), row[key]));
  for (const alias of aliases) {
    const found = map.get(normalizeHeader(alias));
    if (found !== undefined) return found;
  }
  return undefined;
}

type ImportedProduct = {
  sku: string;
  cod: string | null;
  category: string | null;
  guides: string | null;
  minStock: number;
  currentStock: number;
};

function parseTiBase(buffer: Buffer, filename: string): ImportedProduct[] {
  const lower = filename.toLowerCase();
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const parsed: ImportedProduct[] = [];
  for (const row of rows) {
    const sku = textLike(pickField(row, ["SKU"]));
    if (!sku) continue;

    const cod = textLike(pickField(row, ["Cod", "Cód"]));
    const category = textLike(pickField(row, ["Categoria"]));
    const guides = textLike(pickField(row, ["Guias"]));

    const entrada = numberLike(pickField(row, ["Entrada"]));
    const saida = numberLike(pickField(row, ["Saida", "Saída"]));
    const devolucao = numberLike(pickField(row, ["Devolucao", "Devolução"]));
    const finalFromFile = numberLike(pickField(row, ["Estoque Final", "EstoqueFinal"]));
    const minStock = numberLike(pickField(row, ["Estoque Minimo", "Estoque Mínimo", "EstoqueMinimo"]));
    const computedStock = finalFromFile || entrada - saida + devolucao;

    parsed.push({
      sku,
      cod: cod || null,
      category: category || null,
      guides: guides || null,
      minStock,
      currentStock: computedStock
    });
  }

  if (!parsed.length && (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv"))) {
    return [];
  }
  return parsed;
}

export const tiStockRouter = Router();

tiStockRouter.get("/products", authRequired, async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { search, page, pageSize } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(sku ILIKE $${values.length} OR cod ILIKE $${values.length} OR category ILIKE $${values.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const items = await pool.query(
    `
      SELECT *
      FROM ti_stock_products
      ${where}
      ORDER BY updated_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, pageSize, offset]
  );

  return res.json({ items: items.rows, page, pageSize });
});

tiStockRouter.get("/lookup/:value", authRequired, async (req, res) => {
  const ref = String(req.params.value || "").trim();
  if (!ref) return res.status(400).json({ message: "Referencia invalida." });

  const result = await pool.query(
    `
      SELECT *
      FROM ti_stock_products
      WHERE sku = $1 OR cod = $1
      LIMIT 1
    `,
    [ref]
  );
  if (!result.rowCount) return res.status(404).json({ message: "Produto nao encontrado na base TI." });
  return res.json(result.rows[0]);
});

tiStockRouter.get("/alerts-low", authRequired, async (_req, res) => {
  const result = await pool.query(
    `
      SELECT *
      FROM ti_stock_products
      WHERE current_stock <= min_stock
      ORDER BY (min_stock - current_stock) DESC, updated_at DESC
      LIMIT 100
    `
  );
  return res.json({ items: result.rows });
});

tiStockRouter.get("/movements", authRequired, async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });
  const { search, page, pageSize } = parsed.data;

  const filters: string[] = [];
  const values: unknown[] = [];
  if (search?.trim()) {
    values.push(`%${search.trim()}%`);
    filters.push(`(p.sku ILIKE $${values.length} OR p.cod ILIKE $${values.length} OR m.created_by_name ILIKE $${values.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  const result = await pool.query(
    `
      SELECT
        m.*,
        p.sku,
        p.cod,
        p.category
      FROM ti_stock_movements m
      JOIN ti_stock_products p ON p.id = m.product_id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    [...values, pageSize, offset]
  );

  return res.json({ items: result.rows, page, pageSize });
});

tiStockRouter.post("/import-base", authRequired, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ message: "Arquivo da base TI obrigatorio." });

  const rows = parseTiBase(req.file.buffer, req.file.originalname);
  if (!rows.length) {
    return res.status(400).json({ message: "Nao encontramos linhas validas. Verifique cabecalhos: SKU, Cod, Categoria, Guias, Entrada, Saida, Devolucao, Estoque Final, Estoque Minimo." });
  }

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const existing = await client.query(
        `
          SELECT id
          FROM ti_stock_products
          WHERE sku = $1
          LIMIT 1
        `,
        [row.sku]
      );

      if (existing.rowCount) {
        await client.query(
          `
            UPDATE ti_stock_products
            SET
              cod = $2,
              category = $3,
              guides = $4,
              current_stock = $5,
              min_stock = $6,
              updated_at = now()
            WHERE sku = $1
          `,
          [row.sku, row.cod, row.category, row.guides, row.currentStock, row.minStock]
        );
        updated += 1;
      } else {
        await client.query(
          `
            INSERT INTO ti_stock_products (sku, cod, category, guides, current_stock, min_stock)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [row.sku, row.cod, row.category, row.guides, row.currentStock, row.minStock]
        );
        inserted += 1;
      }
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
      processedRows: rows.length,
      insertedRows: inserted,
      updatedRows: updated
    }
  });
});

tiStockRouter.post("/movements", authRequired, async (req: AuthenticatedRequest, res) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Payload invalido." });
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

  const { productRef, movementType, quantity, notes } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const product = await client.query(
      `
        SELECT *
        FROM ti_stock_products
        WHERE sku = $1 OR cod = $1
        LIMIT 1
        FOR UPDATE
      `,
      [productRef.trim()]
    );
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Produto nao encontrado na base TI." });
    }

    const p = product.rows[0];
    const before = Number(p.current_stock || 0);
    let after = before;
    if (movementType === "entry" || movementType === "return") after += quantity;
    if (movementType === "exit") {
      after -= quantity;
      if (after < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Saida maior que o estoque disponivel." });
      }
    }

    await client.query(
      `
        UPDATE ti_stock_products
        SET current_stock = $2, updated_at = now()
        WHERE id = $1
      `,
      [p.id, after]
    );

    const movement = await client.query(
      `
        INSERT INTO ti_stock_movements (
          product_id, movement_type, quantity, stock_before, stock_after, notes, created_by_user_id, created_by_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [p.id, movementType, quantity, before, after, notes || null, req.user.id, req.user.name]
    );

    await client.query("COMMIT");
    return res.status(201).json({ movement: movement.rows[0], product: { ...p, current_stock: after } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

