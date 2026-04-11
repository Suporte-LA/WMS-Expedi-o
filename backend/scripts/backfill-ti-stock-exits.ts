import { pool } from "../src/db.js";

type TiRecord = {
  id: string;
  submitted_at: string;
  maintenance_item: string;
  name: string;
  operation: string;
  phone_model: string | null;
  tablet_model: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
};

function toIsoDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function findTiStockProductForModel(
  client: any,
  modelRef: string,
  maintKey: string
): Promise<any | null> {
  const normalizedModel = modelRef.trim();
  const rawMaint = maintKey.trim();
  const searchTerms = new Set<string>([normalizedModel]);

  if (rawMaint.includes("pelicula") || rawMaint.includes("película")) {
    searchTerms.add(`pelicula ${normalizedModel}`);
    searchTerms.add(`película ${normalizedModel}`);
  } else if (rawMaint.includes("capinha") || rawMaint.includes("capa")) {
    searchTerms.add(`capa ${normalizedModel}`);
    searchTerms.add(`capinha ${normalizedModel}`);
  } else if (rawMaint.includes("celular") || rawMaint.includes("aparelho")) {
    searchTerms.add(normalizedModel);
  } else if (rawMaint.includes("tablet")) {
    searchTerms.add(normalizedModel);
  } else {
    searchTerms.add(`${rawMaint} ${normalizedModel}`.trim());
  }

  const patterns = Array.from(searchTerms).map((term) => term.trim()).filter(Boolean);
  const params: unknown[] = [normalizedModel];
  const likeClauses: string[] = [];

  for (const pattern of patterns) {
    params.push(`%${pattern}%`);
    likeClauses.push(`lower(coalesce(p.description, '')) LIKE lower($${params.length})`);
  }

  let categoryClause = "";
  if (rawMaint.includes("pelicula") || rawMaint.includes("película")) {
    params.push("%pel%");
    categoryClause = ` OR lower(coalesce(p.category, '')) LIKE lower($${params.length})`;
  } else if (rawMaint.includes("capinha") || rawMaint.includes("capa")) {
    params.push("%capa%");
    categoryClause = ` OR lower(coalesce(p.category, '')) LIKE lower($${params.length})`;
  }

  const result = await client.query(
    `
      SELECT p.*
      FROM ti_stock_products p
      WHERE p.sku = $1
         OR p.cod = $1
         OR (${likeClauses.join(" OR ")}${categoryClause})
      ORDER BY p.current_stock DESC, p.updated_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    params
  );

  return result.rowCount ? result.rows[0] : null;
}

async function run() {
  const client = await pool.connect();
  let moved = 0;
  let notFound = 0;
  let noStock = 0;
  let skipped = 0;

  try {
    const pending = await client.query<TiRecord>(
      `
        SELECT r.*
        FROM ti_device_records r
        WHERE NOT EXISTS (
          SELECT 1
          FROM ti_stock_movements m
          WHERE m.movement_type = 'exit'
            AND COALESCE(m.notes, '') LIKE '%' || 'TI_RECORD:' || r.id || '%'
        )
        ORDER BY r.submitted_at ASC
      `
    );

    console.log(`Registros pendentes encontrados: ${pending.rowCount ?? 0}`);

    for (const record of pending.rows) {
      const maintKey = normalizeText(record.maintenance_item || "");
      const isDeviceExchange =
        maintKey.includes("aparelho") || maintKey === "celular" || maintKey === "tablet";

      if (isDeviceExchange) {
        skipped += 1;
        console.log(`SKIP ${record.id} ${record.operation} ${record.name}: troca de aparelho sem modelo entregue explicito.`);
        continue;
      }

      const modelRef = (record.phone_model?.trim() || record.tablet_model?.trim() || "").trim();
      if (!modelRef) {
        skipped += 1;
        console.log(`SKIP ${record.id} ${record.operation} ${record.name}: sem modelo para localizar item.`);
        continue;
      }

      await client.query("BEGIN");
      try {
        const product = await findTiStockProductForModel(client, modelRef, maintKey);
        if (!product) {
          await client.query("ROLLBACK");
          notFound += 1;
          console.log(`NOT_FOUND ${record.id}: ${record.maintenance_item} + ${modelRef}`);
          continue;
        }

        const before = Number(product.current_stock || 0);
        if (before < 1) {
          await client.query("ROLLBACK");
          noStock += 1;
          console.log(`NO_STOCK ${record.id}: ${product.description || product.sku}`);
          continue;
        }

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
            VALUES ($1, 'exit', 1, $2, $3, $4, $5, $6, $7, 'TI-BACKFILL', 'CONSULTOR DE VENDAS', $8)
          `,
          [
            product.id,
            before,
            after,
            `Saida automatica retroativa via TI - ${record.maintenance_item} | TI_RECORD:${record.id}`,
            record.created_by_user_id,
            record.created_by_name || "Backfill TI",
            toIsoDate(record.submitted_at),
            record.name
          ]
        );

        await client.query("COMMIT");
        moved += 1;
        console.log(`OK ${record.id}: ${product.description || product.sku}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("");
    console.log("Resumo:");
    console.log(`- Consolidadas: ${moved}`);
    console.log(`- Nao encontradas: ${notFound}`);
    console.log(`- Sem saldo: ${noStock}`);
    console.log(`- Ignoradas: ${skipped}`);
  } finally {
    client.release();
  }
}

run().catch(async (error) => {
  console.error("Erro no backfill TI:", error);
  await pool.end();
  process.exit(1);
}).then(async () => {
  await pool.end();
});
