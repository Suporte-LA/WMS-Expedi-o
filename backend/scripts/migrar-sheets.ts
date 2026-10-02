import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { parse } from "csv-parse/sync";
import { planSheets, type Sheets } from "../src/stock/migration.js";
import { transaction, audit } from "../src/stock/service.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const folder = option("--dir");
if (!folder)
  throw new Error(
    "Uso: npm run stock:migrate -- --dir pasta_csv [--apply --admin-email email] [--aprovar-negativos HASH]",
  );
const sheets = {} as Sheets;
for (const [key, filename] of [
  ["Cadastro", "Cadastro.csv"],
  ["Ocupacao", "Ocupacao.csv"],
  ["Estoque", "Estoque.csv"],
  ["Lancamento", "Lancamento.csv"],
] as const) {
  const input = await fs.readFile(path.join(folder, filename), "utf8");
  sheets[key] = parse(input, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: input.split(/\r?\n/)[0].includes(";") ? ";" : ",",
  });
}
const plan = planSheets(sheets);
const reportPath =
  option("--report") || path.join(folder, "conferencia-wms.json");
await fs.writeFile(reportPath, JSON.stringify(plan.report, null, 2), "utf8");
console.log(
  `Conferencia gravada em ${reportPath}. Hash de aprovacao: ${plan.fingerprint}`,
);
if (!args.includes("--apply")) {
  console.log(
    "Simulacao: nenhum dado alterado. Revise o relatorio antes de --apply.",
  );
  process.exit(0);
}
if (
  plan.report.errors.length ||
  plan.report.multiplos_produtos_ou_validades.length ||
  plan.report.transferencias_incompletas.length
)
  throw new Error(
    "Importacao bloqueada. Corrija erros, ocupacoes multiplas e transferencias incompletas no CSV.",
  );
if (
  plan.report.negativos.length &&
  option("--aprovar-negativos") !== plan.fingerprint
)
  throw new Error(
    "Saldos negativos: revise o relatorio. Para gerar ajustes de zeragem, passe --aprovar-negativos com o hash deste relatorio.",
  );
const adminEmail = option("--admin-email");
if (!adminEmail)
  throw new Error("--admin-email obrigatorio para auditar a importacao.");
const { pool } = await import("../src/db.js");
try {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV !== "development" ||
    !["localhost", "127.0.0.1", "stock_db"].includes(url.hostname) ||
    !/stock_(dev|test)$/.test(url.pathname)
  )
    throw new Error(
      "Migracao restrita ao banco local de desenvolvimento *_stock_dev/test.",
    );
  await transaction(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73142026)");
    await c.query(
      "LOCK TABLE wms_products,wms_addresses,wms_movements,wms_balances,wms_operations IN ACCESS EXCLUSIVE MODE",
    );
    const admin = (
      await c.query(
        "SELECT id,role FROM users WHERE lower(email)=lower($1) AND is_active AND role IN ('admin','supervisor')",
        [adminEmail],
      )
    ).rows[0];
    if (!admin)
      throw new Error("Administrador/supervisor ativo nao encontrado.");
    if (
      (
        await c.query(
          "SELECT 1 FROM wms_products UNION ALL SELECT 1 FROM wms_addresses UNION ALL SELECT 1 FROM wms_movements LIMIT 1",
        )
      ).rowCount
    )
      throw new Error(
        "Use banco WMS vazio (setup sem --seed). Importacao nao mistura dados demonstrativos ou operacionais.",
      );
    const actor = { ...admin, device: "migrar-sheets", ip: "local" };
    const addressIds = new Map<string, string>(),
      productIds = new Map<string, string>(),
      operatorIds = new Map<string, string>(),
      transferIds = new Map<string, string>();
    for (const a of plan.addresses) {
      await c.query(
        "INSERT INTO wms_streets(galpao,rua) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [a.galpao, a.rua],
      );
      const id = randomUUID();
      addressIds.set(a.codigo, id);
      await c.query(
        "INSERT INTO wms_addresses(id,galpao,rua,coluna,nivel,posicao,bloqueado,motivo_bloqueio) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          a.galpao,
          a.rua,
          a.coluna,
          a.nivel,
          a.posicao,
          a.bloqueado,
          a.motivo_bloqueio,
        ],
      );
      await audit(c, actor, "MIGRACAO_ENDERECO", id, null, a);
    }
    const strict = (
      await c.query(
        "SELECT strict_ean FROM wms_settings WHERE id=true FOR SHARE",
      )
    ).rows[0].strict_ean;
    if (strict && plan.report.warnings.length)
      throw new Error(
        "Validacao estrita de EAN ativa: corrija os EANs reportados.",
      );
    for (const p of plan.products) {
      const id = randomUUID();
      productIds.set(p.codigo, id);
      await c.query(
        "INSERT INTO wms_products(id,codigo,descricao,ean_unidade,ean_caixa,fornecedor,qtd_unitario,qtd_na_caixa,peso,endereco_padrao_id,ativo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          id,
          p.codigo,
          p.descricao,
          p.ean_unidade,
          p.ean_caixa,
          p.fornecedor,
          p.qtd_unitario,
          p.qtd_na_caixa,
          p.peso,
          addressIds.get(p.endereco_padrao) || null,
          p.ativo,
        ],
      );
      await audit(c, actor, "MIGRACAO_PRODUTO", id, null, p);
    }
    for (const name of new Set(plan.movements.map((m) => m.operador))) {
      const existing = await c.query(
        "SELECT id FROM users WHERE lower(trim(name))=lower(trim($1))",
        [name],
      );
      if (existing.rowCount! > 1)
        throw new Error(
          `Operador ambiguo: ${name}. Corrija os nomes antes de importar.`,
        );
      if (existing.rowCount) {
        operatorIds.set(name, existing.rows[0].id);
        continue;
      }
      const id = randomUUID();
      operatorIds.set(name, id);
      const email = `legado-${createHash("sha256").update(name).digest("hex").slice(0, 24)}@migration.invalid`;
      // Inactive identity only. An admin must assign a real email/password before enabling login.
      await c.query(
        "INSERT INTO users(id,name,email,password_hash,role,is_active,workspace) VALUES($1,$2,$3,$4,'operator',false,'estoque')",
        [id, name, email, randomBytes(48).toString("hex")],
      );
      await audit(c, actor, "MIGRACAO_OPERADOR", id, null, {
        name,
        email,
        is_active: false,
      });
    }
    const operation = randomUUID();
    await c.query(
      "INSERT INTO wms_operations(id,operador_id,fingerprint,response) VALUES($1,$2,$3,$4)",
      [
        operation,
        admin.id,
        plan.fingerprint,
        JSON.stringify({ migracao: true, relatorio: plan.report }),
      ],
    );
    const running = new Map<string, number>();
    for (const m of plan.movements) {
      if (m.transferencia && !transferIds.has(m.transferencia))
        transferIds.set(m.transferencia, randomUUID());
      const id = randomUUID();
      const key = [m.endereco, m.produto, m.validade].join("|");
      const before = running.get(key) || 0;
      const after = before + m.quantidade * m.sinal;
      running.set(key, after);
      await c.query(
        "INSERT INTO wms_movements(id,tipo,produto_id,endereco_id,quantidade,sinal,validade,lote,ean_lido,operador_id,observacao,transferencia_id,operation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          id,
          m.tipo,
          productIds.get(m.produto),
          addressIds.get(m.endereco),
          m.quantidade,
          m.sinal,
          m.validade,
          m.lote || null,
          m.ean || null,
          operatorIds.get(m.operador),
          `[${m.source}] ${m.observacao}`,
          m.transferencia ? transferIds.get(m.transferencia) : null,
          operation,
          m.created_at,
        ],
      );
      await audit(
        c,
        actor,
        "MIGRACAO_MOVIMENTO",
        id,
        { saldo: before },
        { ...m, saldo: after, operador_id: operatorIds.get(m.operador) },
      );
    }
    for (const b of plan.balances) {
      if (b.quantidade < 0) {
        const id = randomUUID();
        await c.query(
          "INSERT INTO wms_movements(id,tipo,produto_id,endereco_id,quantidade,sinal,validade,operador_id,observacao,operation_id) VALUES($1,'AJUSTE_INVENTARIO',$2,$3,$4,1,$5,$6,$7,$8)",
          [
            id,
            productIds.get(b.produto),
            addressIds.get(b.endereco),
            -b.quantidade,
            b.validade,
            admin.id,
            `Zeragem de saldo negativo legado aprovada no relatorio ${plan.fingerprint}`,
            operation,
          ],
        );
        await audit(c, actor, "MIGRACAO_ZERAGEM_APROVADA", id, b, {
          ...b,
          quantidade: 0,
          aprovacao: plan.fingerprint,
        });
      }
      await c.query(
        "INSERT INTO wms_balances(endereco_id,produto_id,validade,quantidade) VALUES($1,$2,$3,$4)",
        [
          addressIds.get(b.endereco),
          productIds.get(b.produto),
          b.validade,
          Math.max(0, b.quantidade),
        ],
      );
    }
    await audit(c, actor, "MIGRACAO_CONCLUIDA", operation, null, plan.report);
  });
  console.log(
    "Importacao concluida em uma transacao. Saldos e historico preservados; operadores novos permanecem inativos.",
  );
} finally {
  await pool.end();
}
