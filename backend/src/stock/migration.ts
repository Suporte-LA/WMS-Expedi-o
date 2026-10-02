import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizedKey, productFromRow } from "./imports.js";
import {
  addressSchema,
  decomporEndereco,
  normalizarEan,
  productSchema,
  validarEan,
} from "./rules.js";

type Row = Record<string, unknown>;
export type Sheets = {
  Cadastro: Row[];
  Ocupacao: Row[];
  Estoque: Row[];
  Lancamento: Row[];
};
type Issue = { aba: string; linha: number; erro: string };
export type LegacyMovement = {
  source: string;
  tipo: string;
  produto: string;
  endereco: string;
  origem: string;
  destino: string;
  quantidade: number;
  sinal: number;
  validade: string;
  operador: string;
  created_at: string;
  lote: string;
  ean: string;
  observacao: string;
  transferencia: string;
};
const pick = (r: Row, ...keys: string[]) =>
  String(
    keys
      .map((k) => r[k])
      .find((v) => v !== undefined && v !== null && v !== "") ?? "",
  ).trim();
function date(value: string, timestamp = false) {
  let result = value;
  const br =
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(value);
  if (br) result = `${br[3]}-${br[2]}-${br[1]}${br[4] ? "T" + br[4] : ""}`;
  const day = z.string().date().parse(result.slice(0, 10));
  if (!timestamp) return day;
  if (result.length === 10) result += "T12:00:00-03:00";
  else if (!/(Z|[+-]\d{2}:\d{2})$/.test(result)) result += "-03:00";
  if (!Number.isFinite(Date.parse(result)))
    throw new Error("Data/hora invalida.");
  return new Date(result).toISOString();
}
export function planSheets(input: Sheets) {
  const sheets = Object.fromEntries(
    Object.entries(input).map(([key, rows]) => [
      key,
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [normalizedKey(k), v]),
        ),
      ),
    ]),
  ) as Sheets;
  const errors: Issue[] = [],
    warnings: Issue[] = [];
  const products: (z.infer<typeof productSchema> & {
    endereco_padrao: string;
  })[] = [];
  const addresses: (z.infer<typeof addressSchema> & {
    codigo: string;
    status_legado: string;
  })[] = [];
  const movements: LegacyMovement[] = [];
  const eans = new Map<string, string>(),
    codes = new Set<string>(),
    addressCodes = new Set<string>();
  const each = (aba: keyof Sheets, fn: (r: Row, line: number) => void) =>
    sheets[aba].forEach((r, i) => {
      try {
        fn(r, i + 2);
      } catch (e) {
        errors.push({
          aba,
          linha: i + 2,
          erro:
            e instanceof z.ZodError
              ? e.issues.map((x) => x.message).join("; ")
              : String(e instanceof Error ? e.message : e),
        });
      }
    });
  each("Cadastro", (r, line) => {
    const p = productSchema.parse(productFromRow(r));
    if (codes.has(p.codigo)) throw new Error(`Codigo duplicado: ${p.codigo}`);
    const all = [
      ...new Set(
        [p.ean_unidade, p.ean_caixa].filter((v): v is string => Boolean(v)),
      ),
    ];
    for (const ean of all) {
      if (eans.has(ean))
        throw new Error(`EAN ${ean} pertence a ${eans.get(ean)} e ${p.codigo}`);
      if (!validarEan(ean))
        warnings.push({
          aba: "Cadastro",
          linha: line,
          erro: `EAN com digito/formato invalido: ${ean}`,
        });
    }
    all.forEach((ean) => eans.set(ean, p.codigo));
    codes.add(p.codigo);
    products.push({
      ...p,
      endereco_padrao: pick(r, "endereco_padrao", "endereco_padrao_codigo"),
    });
  });
  each("Ocupacao", (r) => {
    const codigo = pick(r, "endereco", "codigo", "codigo_endereco");
    const coords = decomporEndereco(codigo);
    if (addressCodes.has(codigo))
      throw new Error(`Endereco duplicado: ${codigo}`);
    const status = pick(r, "status");
    const blocked =
      normalizedKey(status) === "bloqueado" ||
      ["true", "sim", "1"].includes(normalizedKey(pick(r, "bloqueado")));
    const a = addressSchema.parse({
      ...coords,
      bloqueado: blocked,
      motivo_bloqueio: blocked
        ? pick(r, "motivo_bloqueio") || "Bloqueio importado do mapa legado"
        : "",
    });
    addresses.push({ ...a, codigo, status_legado: status });
    addressCodes.add(codigo);
  });
  for (const p of products)
    if (p.endereco_padrao && !addressCodes.has(p.endereco_padrao))
      errors.push({
        aba: "Cadastro",
        linha: 0,
        erro: `Endereco padrao inexistente: ${p.codigo} / ${p.endereco_padrao}`,
      });
  const readMovement = (aba: "Estoque" | "Lancamento") =>
    each(aba, (r, line) => {
      const kind = normalizedKey(pick(r, "tipo", "movimento", "operacao"));
      if (
        aba === "Estoque" &&
        !["entrada", "ajuste", "transferencia_entrada", ""].includes(kind)
      )
        throw new Error(`Tipo nao mapeado: ${kind}`);
      if (
        aba === "Lancamento" &&
        !["saida", "ajuste", "transferencia_saida", "mudar", ""].includes(kind)
      )
        throw new Error(`Tipo nao mapeado: ${kind}`);
      const ean = normalizarEan(
        pick(r, "ean_lido", "ean", "ean_unidade", "codigo_barras"),
      );
      const produto =
        pick(r, "codigo_produto", "produto_codigo", "codigo", "produto") ||
        eans.get(ean) ||
        "";
      if (!codes.has(produto))
        throw new Error(`Produto desconhecido: ${produto || ean}`);
      if (ean && eans.get(ean) !== produto)
        throw new Error(`EAN nao pertence ao produto ${produto}`);
      const endereco = pick(r, "endereco", "endereco_codigo");
      decomporEndereco(endereco);
      if (!addressCodes.has(endereco))
        throw new Error(`Endereco desconhecido: ${endereco}`);
      const origem = pick(r, "endereco_origem"),
        destino = pick(r, "endereco_destino");
      for (const other of [origem, destino])
        if (other && !addressCodes.has(other))
          throw new Error(`Endereco de transferencia desconhecido: ${other}`);
      const quantidade = z.coerce
        .number()
        .int()
        .positive()
        .max(2147483647)
        .parse(pick(r, "quantidade", "qtd", "quantidade_unidades"));
      const operador = pick(r, "nome", "operador");
      if (!operador)
        throw new Error("NOME/operador obrigatorio para preservar autoria.");
      const created_at = date(
        pick(r, "created_at", "data_hora", "data", "timestamp"),
        true,
      );
      movements.push({
        source: `${aba}:${line}`,
        tipo:
          aba === "Estoque"
            ? origem
              ? "TRANSFERENCIA_ENTRADA"
              : "ENTRADA"
            : "SAIDA",
        produto,
        endereco,
        origem,
        destino,
        quantidade,
        sinal: aba === "Estoque" ? 1 : -1,
        validade: date(pick(r, "validade", "data_validade")),
        operador,
        created_at,
        lote: pick(r, "lote"),
        ean,
        observacao: pick(r, "observacao", "obs"),
        transferencia: pick(r, "transferencia_id", "id_transferencia"),
      });
    });
  readMovement("Estoque");
  readMovement("Lancamento");
  const transfers: { entrada: string; saidas: string[]; erro: string }[] = [];
  const used = new Set<LegacyMovement>();
  for (const incoming of movements.filter(
    (m) => m.tipo === "TRANSFERENCIA_ENTRADA",
  )) {
    const matches = movements.filter(
      (m) =>
        m.sinal === -1 &&
        !used.has(m) &&
        m.produto === incoming.produto &&
        m.validade === incoming.validade &&
        m.endereco === incoming.origem &&
        (incoming.transferencia
          ? m.transferencia === incoming.transferencia
          : m.destino === incoming.endereco),
    );
    if (
      incoming.origem === incoming.endereco ||
      matches.length !== 1 ||
      matches[0].quantidade !== incoming.quantidade
    ) {
      transfers.push({
        entrada: incoming.source,
        saidas: matches.map((m) => m.source),
        erro: "Transferencia sem par inequivoco ou quantidade origem diferente do destino.",
      });
      continue;
    }
    const out = matches[0];
    used.add(out);
    out.tipo = "TRANSFERENCIA_SAIDA";
    out.transferencia = incoming.transferencia = `par:${incoming.source}`;
  }
  for (const out of movements.filter(
    (m) => m.sinal === -1 && (m.transferencia || m.destino) && !used.has(m),
  ))
    transfers.push({
      entrada: "",
      saidas: [out.source],
      erro: "Saida de transferencia sem entrada correspondente.",
    });
  const balances = new Map<
    string,
    { endereco: string; produto: string; validade: string; quantidade: number }
  >();
  const historicalNegatives: { source: string; saldo: number }[] = [];
  movements.sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      b.sinal - a.sinal ||
      a.source.localeCompare(b.source),
  );
  for (const m of movements) {
    const key = [m.endereco, m.produto, m.validade].join("|");
    const b = balances.get(key) || {
      endereco: m.endereco,
      produto: m.produto,
      validade: m.validade,
      quantidade: 0,
    };
    b.quantidade += m.quantidade * m.sinal;
    balances.set(key, b);
    if (b.quantidade < 0)
      historicalNegatives.push({ source: m.source, saldo: b.quantidade });
  }
  const finalBalances = [...balances.values()];
  const negatives = finalBalances.filter((b) => b.quantidade < 0);
  const conflicts = addresses.flatMap((a) => {
    const rows = finalBalances.filter(
      (b) => b.endereco === a.codigo && b.quantidade > 0,
    );
    return rows.length > 1 ? [{ endereco: a.codigo, saldos: rows }] : [];
  });
  const statusDivergences = addresses.flatMap((a) => {
    const status = a.bloqueado
      ? "Bloqueado"
      : finalBalances.some((b) => b.endereco === a.codigo && b.quantidade > 0)
        ? "Ocupado"
        : "Vazio";
    return a.status_legado &&
      normalizedKey(a.status_legado) !== normalizedKey(status)
      ? [{ endereco: a.codigo, legado: a.status_legado, calculado: status }]
      : [];
  });
  for (const b of finalBalances)
    if (Math.abs(b.quantidade) > 2147483647)
      errors.push({
        aba: "Saldo",
        linha: 0,
        erro: `Saldo excede inteiro: ${b.endereco}`,
      });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(sheets))
    .digest("hex");
  return {
    fingerprint,
    products,
    addresses,
    movements,
    balances: finalBalances,
    report: {
      fingerprint,
      errors,
      warnings,
      negativos: negatives,
      negativos_historicos: historicalNegatives,
      multiplos_produtos_ou_validades: conflicts,
      divergencias_status: statusDivergences,
      transferencias_incompletas: transfers,
      totais: {
        produtos: products.length,
        enderecos: addresses.length,
        movimentos: movements.length,
        operadores: new Set(movements.map((m) => m.operador)).size,
      },
    },
  };
}
export type SheetsPlan = ReturnType<typeof planSheets>;
