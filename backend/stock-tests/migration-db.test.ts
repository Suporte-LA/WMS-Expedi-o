import { beforeAll, afterAll, it, expect } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const url = process.env.STOCK_TEST_DATABASE_URL;
if (!url || !/stock_test$/.test(new URL(url).pathname))
  throw new Error("Use banco descartavel *_stock_test.");
const pool = new Pool({ connectionString: url });
const schema = "migration_" + randomUUID().replaceAll("-", "");
const scopedUrl = new URL(url);
scopedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = new Pool({ connectionString: scopedUrl.toString() });
let folder: string;
const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const script = (name: string, args: string[] = []) =>
  run(
    process.execPath,
    [path.resolve(cwd, "../node_modules/tsx/dist/cli.mjs"), name, ...args],
    {
      cwd,
      env: {
        ...process.env,
        DATABASE_URL: scopedUrl.toString(),
        JWT_SECRET: "migration-test-only",
        NODE_ENV: "development",
        WMS_SEED_PASSWORD: "migration-test-only-password",
      },
      timeout: 30000,
    },
  );
beforeAll(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "wms-migration-test-"));
  await script("scripts/stock/setup.ts", ["--seed-user"]);
  await fs.writeFile(
    path.join(folder, "Cadastro.csv"),
    "codigo;descricao;ean_unidade\nP1;Produto teste;7891234567895\n",
  );
  await fs.writeFile(
    path.join(folder, "Ocupacao.csv"),
    "endereco;status\n101010101;Ocupado\n",
  );
  await fs.writeFile(
    path.join(folder, "Estoque.csv"),
    "codigo;endereco;quantidade;validade;nome;data\nP1;101010101;10;31/01/2027;Legado;01/10/2026\n",
  );
  await fs.writeFile(
    path.join(folder, "Lancamento.csv"),
    "codigo;endereco;quantidade;validade;nome;data\nP1;101010101;12;31/01/2027;Legado;02/10/2026\n",
  );
});
afterAll(async () => {
  await db.end();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  if (folder && path.dirname(path.resolve(folder)) === path.resolve(os.tmpdir()) && path.basename(folder).startsWith('wms-migration-test-')) await fs.rm(folder, { recursive: true });
});
it("dry-run nao escreve e apply exige aprovacao vinculada ao conteudo", async () => {
  await script("scripts/migrar-sheets.ts", ["--dir", folder]);
  expect(
    (await db.query("SELECT count(*)::int AS n FROM wms_movements")).rows[0].n,
  ).toBe(0);
  await expect(
    script("scripts/migrar-sheets.ts", [
      "--dir",
      folder,
      "--apply",
      "--admin-email",
      "admin@wms.local",
    ]),
  ).rejects.toThrow();
  expect(
    (await db.query("SELECT count(*)::int AS n FROM wms_products")).rows[0].n,
  ).toBe(0);
});
it("aprovacao gera ajuste auditado, saldo confere e reimportacao nao duplica", async () => {
  const report = JSON.parse(
    await fs.readFile(path.join(folder, "conferencia-wms.json"), "utf8"),
  );
  const args = [
    "--dir",
    folder,
    "--apply",
    "--admin-email",
    "admin@wms.local",
    "--aprovar-negativos",
    report.fingerprint,
  ];
  await script("scripts/migrar-sheets.ts", args);
  expect(
    (await db.query("SELECT quantidade FROM wms_balances")).rows[0].quantidade,
  ).toBe(0);
  expect(
    (
      await db.query(
        "SELECT sum(quantidade*sinal)::int AS saldo FROM wms_movements",
      )
    ).rows[0].saldo,
  ).toBe(0);
  expect(
    (
      await db.query(
        "SELECT quantidade FROM wms_movements WHERE tipo='AJUSTE_INVENTARIO'",
      )
    ).rows[0].quantidade,
  ).toBe(2);
  expect(
    (await db.query("SELECT is_active FROM users WHERE name='Legado'")).rows[0]
      .is_active,
  ).toBe(false);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM wms_audit WHERE action='MIGRACAO_ZERAGEM_APROVADA'",
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(script("scripts/migrar-sheets.ts", args)).rejects.toThrow();
  expect(
    (await db.query("SELECT count(*)::int AS n FROM wms_movements")).rows[0].n,
  ).toBe(3);
});
