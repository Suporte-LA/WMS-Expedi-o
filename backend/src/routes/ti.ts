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
  deliveredPhoneModel: z.string().optional(),
  deliveredTabletModel: z.string().optional(),
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

const recordParamsSchema = z.object({
  id: z.string().uuid()
});

const catalogUpdateParamsSchema = z.object({
  id: z.string().uuid()
});

const catalogUpdateBodySchema = z.object({
  name: z.string().min(1),
  operation: z.string().min(1),
  phoneModel: z.string().optional(),
  tabletModel: z.string().optional()
});

const normalizeHeader = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");

const textLike = (value: unknown): string => (value == null ? "" : String(value).trim());

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

async function findTiStockProductForModel(
  client: any,
  modelRef: string,
  maintKey: string,
  lockRow = true
): Promise<any | null> {
  const params: unknown[] = [modelRef, `%${modelRef}%`];
  let kindFilter = "";
  if (maintKey.includes("pelicula")) {
    params.push("%pelicula%");
    kindFilter = ` AND lower(coalesce(p.category, '')) LIKE $${params.length}`;
  } else if (maintKey.includes("capinha") || maintKey.includes("capa")) {
    params.push("%cap%");
    kindFilter = ` AND lower(coalesce(p.category, '')) LIKE $${params.length}`;
  }

  const lockClause = lockRow ? "FOR UPDATE" : "";
  const product = await client.query(
    `
      SELECT p.*
      FROM ti_stock_products p
      WHERE p.sku = $1
         OR p.cod = $1
         OR lower(coalesce(p.description, '')) LIKE lower($2)
         ${kindFilter}
      ORDER BY p.current_stock DESC, p.updated_at DESC
      LIMIT 1
      ${lockClause}
    `,
    params
  );
  if (!product.rowCount) return null;
  return product.rows[0];
}

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

tiRouter.patch("/catalog/:id", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });

  const parsedParams = catalogUpdateParamsSchema.safeParse(req.params);
  if (!parsedParams.success) return res.status(400).json({ message: "ID invalido." });

  const parsedBody = catalogUpdateBodySchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ message: "Payload invalido." });

  const { id } = parsedParams.data;
  const data = parsedBody.data;

  try {
    const result = await pool.query(
      `
        UPDATE ti_device_catalog
        SET
          name = $2,
          operation = $3,
          phone_model = $4,
          tablet_model = $5,
          updated_at = now()
        WHERE id = $1
        RETURNING id, name, operation, phone_model, tablet_model, updated_at
      `,
      [id, data.name.trim(), data.operation.trim(), data.phoneModel?.trim() || null, data.tabletModel?.trim() || null]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Registro nao encontrado." });
    }

    return res.json(result.rows[0]);
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ message: "Ja existe esse Nome + Operacao na base." });
    }
    throw error;
  }
});

tiRouter.post("/records", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Payload invalido." });
  if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

  const data = parsed.data;
  const submittedAt = data.submittedAt ? new Date(data.submittedAt) : new Date();
  const maintenance = data.maintenanceItem.trim();
  const maintKey = normalizeText(maintenance);
  const modelRef = (data.phoneModel?.trim() || data.tabletModel?.trim() || "").trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
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
        maintenance,
        data.name.trim(),
        data.operation.trim(),
        data.phoneModel?.trim() || null,
        data.tabletModel?.trim() || null,
        req.user.id,
        req.user.name
      ]
    );

    let stockIntegration: { status: "moved" | "not_found" | "no_stock" | "skipped"; message: string } = {
      status: "skipped",
      message: "Sem modelo para vincular estoque automaticamente."
    };

    const deliveredModelRef = (data.deliveredPhoneModel?.trim() || data.deliveredTabletModel?.trim() || "").trim();
    const isDeviceExchange = maintKey.includes("aparelho") || maintKey === "celular" || maintKey === "tablet";
    const integrationMessages: string[] = [];

    if (isDeviceExchange && modelRef) {
      const oldProduct = await findTiStockProductForModel(client, modelRef, maintKey, true);
      if (!oldProduct) {
        integrationMessages.push(`Nao achamos aparelho antigo "${modelRef}" para entrada no estoque.`);
      } else {
        const before = Number(oldProduct.current_stock || 0);
        const after = before + 1;
        await client.query(
          `
            UPDATE ti_stock_products
            SET current_stock = $2, updated_at = now()
            WHERE id = $1
          `,
          [oldProduct.id, after]
        );
        await client.query(
          `
            INSERT INTO ti_stock_movements (
              product_id, movement_type, quantity, stock_before, stock_after, notes, created_by_user_id, created_by_name,
              movement_date, guide, movement_code, destination_final
            )
            VALUES ($1, 'return', 1, $2, $3, $4, $5, $6, $7, 'TI-AUTO-EXCHANGE', 'ESTOQUE TI', $8)
          `,
          [
            oldProduct.id,
            before,
            after,
            `Entrada automatica via TI troca - ${maintenance} | TI_RECORD:${created.rows[0].id}`,
            req.user.id,
            req.user.name,
            new Date().toISOString().slice(0, 10),
            data.name.trim()
          ]
        );
        integrationMessages.push(`Entrada automatica registrada para "${oldProduct.description || oldProduct.sku}".`);
      }
    }

    if (isDeviceExchange && !deliveredModelRef) {
      stockIntegration = {
        status: "skipped",
        message: "Registro salvo, mas faltou informar o aparelho entregue para gerar a saida no estoque."
      };
    } else {
      const exitModelRef = isDeviceExchange ? deliveredModelRef : modelRef;
      if (exitModelRef) {
        const product = await findTiStockProductForModel(client, exitModelRef, maintKey, true);
        if (!product) {
          stockIntegration = {
            status: "not_found",
            message: `Nao achamos item no Estoque TI para o modelo "${exitModelRef}".`
          };
        } else {
          const before = Number(product.current_stock || 0);
          if (before < 1) {
            stockIntegration = {
              status: "no_stock",
              message: `Estoque TI sem saldo para "${product.description || product.sku}".`
            };
          } else {
            const after = before - 1;
            await client.query(
              `
                UPDATE ti_stock_products
                SET current_stock = $2, updated_at = now()
                WHERE id = $1
              `,
              [product.id, after]
            );
            await client.query(
              `
                INSERT INTO ti_stock_movements (
                  product_id, movement_type, quantity, stock_before, stock_after, notes, created_by_user_id, created_by_name,
                  movement_date, guide, movement_code, destination_final
                )
                VALUES ($1, 'exit', 1, $2, $3, $4, $5, $6, $7, $8, 'CONSULTOR DE VENDAS', $9)
              `,
              [
                product.id,
                before,
                after,
                `Saida automatica via TI - ${maintenance} | TI_RECORD:${created.rows[0].id}`,
                req.user.id,
                req.user.name,
                new Date().toISOString().slice(0, 10),
                "TI-AUTO",
                data.name.trim()
              ]
            );

            stockIntegration = {
              status: "moved",
              message: `Saida automatica registrada no Estoque TI para "${product.description || product.sku}".`
            };
          }
        }
      }
    }

    if (integrationMessages.length) {
      stockIntegration = {
        status: stockIntegration.status === "moved" ? "moved" : "skipped",
        message: [...integrationMessages, stockIntegration.message].filter(Boolean).join(" ")
      };
    }

    await client.query("COMMIT");
    return res.status(201).json({ ...created.rows[0], stockIntegration });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    filters.push(`(r.submitted_at AT TIME ZONE 'America/Sao_Paulo')::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`(r.submitted_at AT TIME ZONE 'America/Sao_Paulo')::date <= $${values.length}::date`);
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

tiRouter.delete("/records/:id", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = recordParamsSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ message: "ID invalido." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recordResult = await client.query(
      `
        SELECT id, name, maintenance_item
        FROM ti_device_records
        WHERE id = $1
        FOR UPDATE
      `,
      [parsed.data.id]
    );
    if (!recordResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Registro nao encontrado." });
    }

    let stockReversal: { status: "reverted" | "not_found"; message: string } = {
      status: "not_found",
      message: "Sem saida automatica vinculada para reverter."
    };

    const movementResult = await client.query(
      `
        SELECT m.*, p.id AS product_id, p.current_stock
        FROM ti_stock_movements m
        JOIN ti_stock_products p ON p.id = m.product_id
        WHERE m.movement_type IN ('exit', 'return')
          AND COALESCE(m.notes, '') LIKE $1
        ORDER BY m.created_at DESC
        FOR UPDATE
      `,
      [`%TI_RECORD:${parsed.data.id}%`]
    );

    if (movementResult.rowCount) {
      for (const movement of movementResult.rows) {
        const qty = Number(movement.quantity || 0);
        const current = Number(movement.current_stock || 0);
        const reverseType = movement.movement_type === "exit" ? "return" : "exit";
        const next = reverseType === "return" ? current + qty : current - qty;
        if (next < 0) continue;

        await client.query(
          `
            UPDATE ti_stock_products
            SET current_stock = $2, updated_at = now()
            WHERE id = $1
          `,
          [movement.product_id, next]
        );
        await client.query(
          `
            INSERT INTO ti_stock_movements (
              product_id, movement_type, quantity, stock_before, stock_after, notes, created_by_user_id, created_by_name,
              movement_date, guide, movement_code, destination_final
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'TI-AUTO-REV', 'ESTOQUE TI', $10)
          `,
          [
            movement.product_id,
            reverseType,
            qty,
            current,
            next,
            `Reversao automatica de movimento TI (${movement.movement_type}) | TI_RECORD:${parsed.data.id}`,
            req.user?.id || movement.created_by_user_id || null,
            req.user?.name || movement.created_by_name || "Sistema",
            new Date().toISOString().slice(0, 10),
            recordResult.rows[0].name || null
          ]
        );
      }
      stockReversal = {
        status: "reverted",
        message: "Movimentacoes automaticas revertidas no Estoque TI."
      };
    }

    await client.query(
      `
        DELETE FROM ti_device_records
        WHERE id = $1
      `,
      [parsed.data.id]
    );
    await client.query("COMMIT");
    return res.status(200).json({ success: true, stockReversal });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

tiRouter.get("/control", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!requireTiAccess(req)) return res.status(403).json({ message: "Permissao insuficiente." });
  const parsed = controlSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, name, operation, item } = parsed.data;
  const refDate = to || new Date().toISOString().slice(0, 10);
  const filters: string[] = [];
  const values: unknown[] = [];
  if (from) {
    values.push(from);
    filters.push(`(r.submitted_at AT TIME ZONE 'America/Sao_Paulo')::date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`(r.submitted_at AT TIME ZONE 'America/Sao_Paulo')::date <= $${values.length}::date`);
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

  const [limitsRes, recordsRes] = await Promise.all([
    pool.query(`SELECT item, months_limit, max_count FROM ti_device_limits`),
    pool.query(
      `
        SELECT
          r.name,
          r.operation,
          r.maintenance_item,
          r.submitted_at,
          to_char((r.submitted_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS local_date
        FROM ti_device_records r
        ${where}
        ORDER BY r.submitted_at DESC
      `,
      values
    )
  ]);

  const limitMap = new Map<string, { months: number; max: number }>();
  for (const row of limitsRes.rows) {
    limitMap.set(String(row.item).toLowerCase(), {
      months: Number(row.months_limit) || 6,
      max: Number(row.max_count) || 1
    });
  }

  const monthlyMap = new Map<string, { month: string; name: string; operation: string; maintenance_item: string; total_count: number }>();
  for (const row of recordsRes.rows as Array<{ local_date: string; name: string; operation: string; maintenance_item: string }>) {
    const month = (row.local_date || "").slice(0, 7);
    const key = `${month}||${row.name}||${row.operation}||${row.maintenance_item}`;
    const current = monthlyMap.get(key);
    if (current) {
      current.total_count += 1;
    } else {
      monthlyMap.set(key, {
        month,
        name: row.name,
        operation: row.operation,
        maintenance_item: row.maintenance_item,
        total_count: 1
      });
    }
  }
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => {
    if (a.month !== b.month) return b.month.localeCompare(a.month);
    if (a.operation !== b.operation) return a.operation.localeCompare(b.operation);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.maintenance_item.localeCompare(b.maintenance_item);
  });

  const reference = new Date(`${refDate}T12:00:00-03:00`);
  const fromDate = from ? new Date(`${from}T00:00:00-03:00`) : null;
  const grouped = new Map<string, { name: string; operation: string; maintenance_item: string; localDates: string[]; lastDate: string }>();
  for (const row of recordsRes.rows as Array<{ local_date: string; name: string; operation: string; maintenance_item: string }>) {
    const key = `${row.name}||${row.operation}||${row.maintenance_item}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.localDates.push(row.local_date);
      if (row.local_date > existing.lastDate) existing.lastDate = row.local_date;
    } else {
      grouped.set(key, {
        name: row.name,
        operation: row.operation,
        maintenance_item: row.maintenance_item,
        localDates: [row.local_date],
        lastDate: row.local_date
      });
    }
  }

  const limitRows = Array.from(grouped.values()).map((group) => {
    const key = resolveLimitKey(group.maintenance_item || "");
    const conf = limitMap.get(key) || { months: 6, max: 1 };
    const start = new Date(reference);
    start.setMonth(start.getMonth() - conf.months);
    const effectiveStart = fromDate && fromDate > start ? fromDate : start;
    const total = group.localDates.filter((d) => {
      const current = new Date(`${d}T12:00:00-03:00`);
      return current >= effectiveStart && current <= reference;
    }).length;
    return {
      name: group.name,
      operation: group.operation,
      maintenance_item: group.maintenance_item,
      last_date: group.lastDate,
      months_limit: conf.months,
      max_count: conf.max,
      total_count: total,
      status: total > conf.max ? "fora_do_limite" : "dentro_do_limite"
    };
  });

  limitRows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "fora_do_limite" ? -1 : 1;
    if (a.operation !== b.operation) return a.operation.localeCompare(b.operation);
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.maintenance_item.localeCompare(b.maintenance_item);
  });

  return res.json({ reference_date: refDate, limits: limitRows, monthly });
});

