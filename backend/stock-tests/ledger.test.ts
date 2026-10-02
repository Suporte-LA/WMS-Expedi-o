import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { Pool } from "pg";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { StockService, type Actor } from "../src/stock/service.js";

const url = process.env.STOCK_TEST_DATABASE_URL;
if (!url || !/stock_test$/.test(new URL(url).pathname))
  throw new Error(
    "Defina STOCK_TEST_DATABASE_URL para um banco descartavel *_stock_test.",
  );
const pool = new Pool({ connectionString: url, max: 10 });
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const scoped = new Pool({
  connectionString: url,
  options: `-c search_path=${schema},public`,
  max: 10,
});
const service = new StockService(scoped);
let actor: Actor;
let product: string;
let addresses: string[];
beforeAll(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await scoped.query("CREATE TABLE users(id uuid PRIMARY KEY, name text)");
  await scoped.query(
    await fs.readFile(
      new URL("../stock-sql/001_addressed_stock.sql", import.meta.url),
      "utf8",
    ),
  );
});
beforeEach(async () => {
  // Separate addresses and products per case; immutable histories are never deleted.
  actor = {
    id: randomUUID(),
    role: "supervisor",
    ip: "127.0.0.1",
    device: "vitest",
  };
  await scoped.query("INSERT INTO users VALUES($1,'Teste')", [actor.id]);
  const rua = (await scoped.query("SELECT count(*)::int AS count FROM users"))
    .rows[0].count;
  await scoped.query("INSERT INTO wms_streets(galpao,rua) VALUES(1,$1)", [rua]);
  addresses = (
    await scoped.query(
      "INSERT INTO wms_addresses(galpao,rua,coluna,nivel,posicao) SELECT 1,$1,c,1,1 FROM generate_series(1,3)c RETURNING id",
      [rua],
    )
  ).rows.map((r) => r.id);
  product = (
    await service.saveProduct(
      {
        codigo: randomUUID(),
        descricao: "Produto",
        ean_unidade: String(Date.now()) + rua,
        ean_caixa: String(Date.now()) + rua + "1",
        qtd_na_caixa: 12,
      },
      actor,
    )
  ).produto.id;
  await scoped.query(
    "UPDATE wms_settings SET allow_same_expiry=false,strict_ean=false",
  );
});
afterAll(async () => {
  await scoped.end();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});
const op = (tipo: string, other: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  tipo,
  produto_id: product,
  endereco_id: addresses[0],
  quantidade: 10,
  validade: "2027-01-31",
  ...other,
});
const saldo = async (id: string) =>
  (
    await scoped.query(
      "SELECT coalesce(sum(quantidade),0)::int AS quantidade FROM wms_balances WHERE endereco_id=$1",
      [id],
    )
  ).rows[0].quantidade;
it("entrada e saldo sao atomicos e auditados", async () => {
  await service.execute(op("ENTRADA"), actor);
  expect(await saldo(addresses[0])).toBe(10);
  expect(
    (
      await scoped.query("SELECT * FROM wms_audit WHERE operador_id=$1", [
        actor.id,
      ])
    ).rowCount,
  ).toBe(2);
});
it("bloqueia entrada ocupada e endereco bloqueado", async () => {
  await service.execute(op("ENTRADA"), actor);
  await expect(service.execute(op("ENTRADA"), actor)).rejects.toThrow(
    "ocupado",
  );
  await scoped.query(
    "UPDATE wms_addresses SET bloqueado=true,motivo_bloqueio='Teste' WHERE id=$1",
    [addresses[1]],
  );
  await expect(
    service.execute(op("ENTRADA", { endereco_id: addresses[1] }), actor),
  ).rejects.toThrow("bloqueado");
});
it("saida nao usa saldo do cliente e nunca fica negativa", async () => {
  await service.execute(op("ENTRADA"), actor);
  await expect(
    service.execute(op("SAIDA", { quantidade: 11 }), actor),
  ).rejects.toThrow("insuficiente");
  expect(await saldo(addresses[0])).toBe(10);
});
it("duas saidas concorrentes nao consomem o mesmo saldo", async () => {
  await service.execute(op("ENTRADA"), actor);
  const results = await Promise.allSettled([
    service.execute(op("SAIDA", { quantidade: 7 }), actor),
    service.execute(op("SAIDA", { quantidade: 7 }), actor),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await saldo(addresses[0])).toBe(3);
});
it("duas entradas concorrentes em posicao vazia aceitam apenas uma", async () => {
  const results = await Promise.allSettled([
    service.execute(op("ENTRADA"), actor),
    service.execute(op("ENTRADA"), actor),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await saldo(addresses[0])).toBe(10);
});
it("transferencia parcial move a mesma quantidade nas duas pernas", async () => {
  await service.execute(op("ENTRADA"), actor);
  const result = await service.execute(
    op("TRANSFERENCIA", { destino_id: addresses[1], quantidade: 4 }),
    actor,
  );
  expect(await saldo(addresses[0])).toBe(6);
  expect(await saldo(addresses[1])).toBe(4);
  expect(
    result.movimentos.map((m: { quantidade: number }) => m.quantidade),
  ).toEqual([4, 4]);
  expect(result.movimentos[0].transferencia_id).toBe(
    result.movimentos[1].transferencia_id,
  );
});
it("destino ocupado desfaz toda transferencia", async () => {
  await service.execute(op("ENTRADA"), actor);
  await service.execute(op("ENTRADA", { endereco_id: addresses[1] }), actor);
  await expect(
    service.execute(
      op("TRANSFERENCIA", { destino_id: addresses[1], quantidade: 4 }),
      actor,
    ),
  ).rejects.toThrow("ocupado");
  expect(await saldo(addresses[0])).toBe(10);
});
it("reenvio offline idempotente nao duplica movimento", async () => {
  const input = op("ENTRADA");
  await Promise.all([
    service.execute(input, actor),
    service.execute(input, actor),
  ]);
  expect(await saldo(addresses[0])).toBe(10);
  await expect(
    service.execute({ ...input, quantidade: 20 }, actor),
  ).rejects.toThrow("Identificador");
});
it("estorno de transferencia e atomico e so ocorre uma vez", async () => {
  await service.execute(op("ENTRADA"), actor);
  const result = await service.execute(
    op("TRANSFERENCIA", { destino_id: addresses[1], quantidade: 4 }),
    actor,
  );
  const reverse = op("ESTORNO", {
    movimento_id: result.movimentos[0].id,
    observacao: "Erro de coleta",
  });
  await service.execute(reverse, actor);
  expect(await saldo(addresses[0])).toBe(10);
  expect(await saldo(addresses[1])).toBe(0);
  await expect(
    service.execute({ ...reverse, request_id: randomUUID() }, actor),
  ).rejects.toThrow("ja estornado");
});
it("ledger nao permite editar nem excluir", async () => {
  await service.execute(op("ENTRADA"), actor);
  await expect(
    scoped.query(
      "UPDATE wms_movements SET quantidade=999 WHERE produto_id=$1",
      [product],
    ),
  ).rejects.toThrow("imutaveis");
  await expect(
    scoped.query("DELETE FROM wms_movements WHERE produto_id=$1", [product]),
  ).rejects.toThrow("imutaveis");
});
it("FEFO avisa sem bloquear", async () => {
  await service.execute(op("ENTRADA"), actor);
  const result = await service.execute(
    op("ENTRADA", { endereco_id: addresses[1], validade: "2026-12-31" }),
    actor,
  );
  expect(result.avisos[0]).toContain("FEFO");
  expect(await saldo(addresses[1])).toBe(10);
});
it("configuracao permite apenas mesmo produto e validade", async () => {
  await service.execute(op("ENTRADA"), actor);
  await scoped.query("UPDATE wms_settings SET allow_same_expiry=true");
  await service.execute(op("ENTRADA"), actor);
  expect(await saldo(addresses[0])).toBe(20);
  await expect(
    service.execute(op("ENTRADA", { validade: "2027-02-01" }), actor),
  ).rejects.toThrow("ocupado");
});
it("EAN unico entre colunas e conversao de caixas", async () => {
  const p = (
    await scoped.query("SELECT * FROM wms_products WHERE id=$1", [product])
  ).rows[0];
  await expect(
    service.saveProduct(
      {
        codigo: randomUUID(),
        descricao: "Duplicado",
        ean_unidade: p.ean_caixa,
      },
      actor,
    ),
  ).rejects.toThrow();
  const found = await service.resolverProduto(p.ean_caixa);
  expect(found.embalagem).toBe("CAIXA");
  await service.execute(
    op("ENTRADA", { ean_lido: p.ean_caixa, caixas: true, quantidade: 2 }),
    actor,
  );
  expect(await saldo(addresses[0])).toBe(24);
});
it("inventario exige supervisor e motivo e usa diferenca", async () => {
  await service.execute(op("ENTRADA"), actor);
  await expect(
    service.execute(
      op("AJUSTE_INVENTARIO", { quantidade: 3, observacao: "Contagem fisica" }),
      { ...actor, role: "operator" },
    ),
  ).rejects.toThrow("supervisor");
  await service.execute(
    op("AJUSTE_INVENTARIO", { quantidade: 3, observacao: "Contagem fisica" }),
    actor,
  );
  expect(await saldo(addresses[0])).toBe(3);
});
it("estorno falha integralmente quando destino ja foi consumido", async () => {
  await service.execute(op("ENTRADA"), actor);
  const moved = await service.execute(
    op("TRANSFERENCIA", { destino_id: addresses[1], quantidade: 4 }),
    actor,
  );
  await service.execute(
    op("SAIDA", { endereco_id: addresses[1], quantidade: 2 }),
    actor,
  );
  await expect(
    service.execute(
      op("ESTORNO", {
        movimento_id: moved.movimentos[0].id,
        observacao: "Reverter transferencia",
      }),
      actor,
    ),
  ).rejects.toThrow("insuficiente");
  expect(await saldo(addresses[0])).toBe(6);
  expect(await saldo(addresses[1])).toBe(2);
});
it("saida de outro produto nao usa saldo da posicao", async () => {
  await service.execute(op("ENTRADA"), actor);
  const other = await service.saveProduct(
    {
      codigo: randomUUID(),
      descricao: "Outro produto",
      ean_unidade: Date.now() + "999",
    },
    actor,
  );
  await expect(
    service.execute(op("SAIDA", { produto_id: other.produto.id }), actor),
  ).rejects.toThrow("insuficiente");
  expect(await saldo(addresses[0])).toBe(10);
});
it("configuracao estrita rejeita digito invalido", async () => {
  await scoped.query("UPDATE wms_settings SET strict_ean=true");
  await expect(
    service.saveProduct(
      { codigo: randomUUID(), descricao: "EAN invalido", ean_unidade: "123" },
      actor,
    ),
  ).rejects.toThrow("EAN invalido");
  await scoped.query("UPDATE wms_settings SET strict_ean=false");
});
