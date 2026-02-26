import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const sqlDir = path.resolve(__dirname, "../sql");
  const files = (await fs.readdir(sqlDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const filename of files) {
    const already = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [filename]);
    if (already.rowCount) continue;

    const sqlPath = path.join(sqlDir, filename);
    const sql = await fs.readFile(sqlPath, "utf-8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [filename]);
      await pool.query("COMMIT");
      console.log(`Migration aplicada: ${filename}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  await pool.end();
}

run().catch(async (error) => {
  console.error("Erro na migration:", error);
  await pool.end();
  process.exit(1);
});
