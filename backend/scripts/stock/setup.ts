import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool } from "../../src/db.js";
import { StockService } from "../../src/stock/service.js";

const database = new URL(process.env.DATABASE_URL!);
if (
  !/stock_(dev|test)$/.test(database.pathname) ||
  !["localhost", "127.0.0.1", "stock_db"].includes(database.hostname)
) {
  throw new Error(
    "Setup permitido apenas no banco local *_stock_dev ou *_stock_test. Configure DATABASE_URL.",
  );
}
try {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      DO $$ BEGIN CREATE TYPE role_type AS ENUM('admin','supervisor','operator','conferente'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,email text UNIQUE NOT NULL,password_hash text NOT NULL,role role_type NOT NULL DEFAULT 'operator',is_active boolean NOT NULL DEFAULT true,pen_color text NOT NULL DEFAULT 'Blue',workspace text NOT NULL DEFAULT 'estoque',created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),action text NOT NULL,meta jsonb,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS user_workspace_permissions(user_id uuid REFERENCES users(id),workspace text,is_enabled boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,workspace));
      CREATE TABLE IF NOT EXISTS wms_schema_migrations(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());`);
    await c.query("SELECT pg_advisory_xact_lock(73142026)");
    const folder = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../stock-sql",
    );
    for (const name of (await fs.readdir(folder))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (
          await c.query(
            "SELECT 1 FROM wms_schema_migrations WHERE filename=$1",
            [name],
          )
        ).rowCount
      )
        continue;
      await c.query(await fs.readFile(path.join(folder, name), "utf8"));
      await c.query("INSERT INTO wms_schema_migrations(filename) VALUES($1)", [
        name,
      ]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  if (process.argv.includes("--seed") || process.argv.includes("--seed-user")) {
    const password = process.env.WMS_SEED_PASSWORD;
    if (!password || password.length < 12)
      throw new Error("Defina WMS_SEED_PASSWORD com pelo menos 12 caracteres.");
    const admin = (
      await pool.query(
        `INSERT INTO users(name,email,password_hash,role,workspace) VALUES('Administrador WMS','admin@wms.local',$1,'admin','estoque') ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id`,
        [await bcrypt.hash(password, 10)],
      )
    ).rows[0];
    if (process.argv.includes("--seed")) {
      await pool.query(
        "INSERT INTO wms_streets(galpao,rua) VALUES(1,1),(1,2) ON CONFLICT DO NOTHING",
      );
      await pool.query(
        "INSERT INTO wms_addresses(galpao,rua,coluna,nivel,posicao) SELECT 1,r,c,1,1 FROM generate_series(1,2)r CROSS JOIN generate_series(1,14)c ON CONFLICT DO NOTHING",
      );
      if (
        !(
          await pool.query("SELECT 1 FROM wms_products WHERE codigo='DEMO-001'")
        ).rowCount
      )
        await new StockService(pool).saveProduct(
          {
            codigo: "DEMO-001",
            descricao: "Produto de demonstracao",
            ean_unidade: "7891234567895",
            ean_caixa: "17891234567892",
            fornecedor: "Demonstracao",
            qtd_na_caixa: 12,
            peso: 1,
          },
          { id: admin.id, role: "admin", device: "seed" },
        );
    }
    console.log(
      "Seed pronto. Login: admin@wms.local. A senha existente nao e alterada em novas execucoes.",
    );
  }
  console.log("Estrutura de estoque local pronta.");
} finally {
  await pool.end();
}
