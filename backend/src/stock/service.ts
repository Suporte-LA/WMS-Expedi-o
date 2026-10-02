import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "../services/httpError.js";
import {
  normalizarEan,
  operationSchema,
  productSchema,
  validarEan,
  type StockOperation,
} from "./rules.js";

export type Actor = { id: string; role: string; ip?: string; device?: string };
type Movement = {
  id: string;
  tipo: string;
  produto_id: string;
  endereco_id: string;
  quantidade: number;
  sinal: number;
  validade: string;
  lote: string | null;
  ean_lido: string | null;
  transferencia_id: string | null;
  estorno_de_id: string | null;
};
export async function transaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export function requireManager(actor: Actor) {
  if (!["admin", "supervisor"].includes(actor.role))
    throw new HttpError(
      403,
      "Somente administrador ou supervisor pode executar esta acao.",
    );
}
export async function audit(
  client: PoolClient,
  actor: Actor,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
) {
  await client.query(
    `INSERT INTO wms_audit(operador_id,action,entity_id,ip,device,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      actor.id,
      action,
      id,
      actor.ip || null,
      actor.device?.slice(0, 500) || null,
      JSON.stringify(before),
      JSON.stringify(after),
    ],
  );
}
export class StockService {
  constructor(readonly pool: Pool) {}
  async resolverProduto(raw: string) {
    const ean = normalizarEan(raw);
    const result = await this.pool.query(
      `SELECT p.*, e.embalagem FROM wms_product_eans e JOIN wms_products p ON p.id=e.produto_id WHERE e.ean=$1 AND p.ativo`,
      [ean],
    );
    if (!result.rowCount) throw new HttpError(404, "CÓDIGO INVÁLIDO");
    return {
      ...result.rows[0],
      ean_lido: ean,
      aviso: validarEan(ean)
        ? null
        : "EAN com formato ou digito verificador invalido.",
    };
  }
  async saveProduct(input: unknown, actor: Actor, id?: string) {
    requireManager(actor);
    const value = productSchema.parse(input);
    return transaction(this.pool, async (c) => {
      const settings = (
        await c.query("SELECT * FROM wms_settings WHERE id=true FOR SHARE")
      ).rows[0];
      const warnings = [value.ean_unidade, value.ean_caixa]
        .filter((v): v is string => Boolean(v) && !validarEan(v!))
        .map((v) => `EAN invalido: ${v}`);
      if (settings.strict_ean && warnings.length)
        throw new HttpError(422, warnings.join("; "));
      const before = id
        ? (
            await c.query("SELECT * FROM wms_products WHERE id=$1 FOR UPDATE", [
              id,
            ])
          ).rows[0]
        : null;
      if (id && !before) throw new HttpError(404, "Produto nao encontrado.");
      const columns = [
        "codigo",
        "descricao",
        "ean_unidade",
        "ean_caixa",
        "fornecedor",
        "qtd_unitario",
        "qtd_na_caixa",
        "peso",
        "endereco_padrao_id",
        "ativo",
      ] as const;
      const values = columns.map((col) => value[col] ?? null);
      const result = id
        ? await c.query(
            `UPDATE wms_products SET ${columns.map((col, i) => `${col}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$11 RETURNING *`,
            [...values, id],
          )
        : await c.query(
            `INSERT INTO wms_products(${columns.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
            values,
          );
      await audit(
        c,
        actor,
        id ? "PRODUTO_ATUALIZADO" : "PRODUTO_CRIADO",
        result.rows[0].id,
        before,
        result.rows[0],
      );
      return { produto: result.rows[0], avisos: warnings };
    });
  }
  async execute(input: unknown, actor: Actor) {
    const op = operationSchema.parse(input);
    if (["AJUSTE_INVENTARIO", "ESTORNO"].includes(op.tipo))
      requireManager(actor);
    if (!["admin", "supervisor", "operator"].includes(actor.role))
      throw new HttpError(403, "Perfil sem acesso ao estoque.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(op))
      .digest("hex");
    return transaction(this.pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        op.request_id,
      ]);
      const saved = (
        await c.query("SELECT * FROM wms_operations WHERE id=$1", [
          op.request_id,
        ])
      ).rows[0];
      if (saved) {
        if (saved.operador_id !== actor.id || saved.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Identificador ja utilizado por outra operacao.",
          );
        return { ...saved.response, repetida: true };
      }
      const settings = (
        await c.query("SELECT * FROM wms_settings WHERE id=true FOR SHARE")
      ).rows[0];
      const movements: Movement[] = [];
      const avisos: string[] = [];
      if (op.tipo === "ESTORNO") await this.reverse(c, op, actor, movements);
      else {
        const product = (
          await c.query("SELECT * FROM wms_products WHERE id=$1 FOR SHARE", [
            op.produto_id,
          ])
        ).rows[0];
        if (!product) throw new HttpError(404, "Produto nao encontrado.");
        if (op.tipo === "ENTRADA" && !product.ativo)
          throw new HttpError(409, "Produto inativo.");
        if (
          op.ean_lido &&
          ![product.ean_unidade, product.ean_caixa].includes(
            normalizarEan(op.ean_lido),
          )
        )
          throw new HttpError(409, "EAN nao pertence ao produto informado.");
        if (
          op.caixas &&
          (!op.ean_lido || normalizarEan(op.ean_lido) !== product.ean_caixa)
        )
          throw new HttpError(
            422,
            "Conversao em caixas exige bipagem do EAN de caixa.",
          );
        const quantity =
          op.quantidade! * (op.caixas ? product.qtd_na_caixa : 1);
        if (!Number.isSafeInteger(quantity) || quantity > 2147483647)
          throw new HttpError(422, "Quantidade excede o limite.");
        await this.lockAddresses(c, [
          op.endereco_id!,
          ...(op.destino_id ? [op.destino_id] : []),
        ]);
        if (op.tipo === "ENTRADA") {
          const fefo = (
            await c.query(
              `SELECT min(validade)::text AS validade FROM wms_balances WHERE produto_id=$1 AND endereco_id<>$2 AND quantidade>0 AND validade>$3::date`,
              [op.produto_id, op.endereco_id, op.validade],
            )
          ).rows[0]?.validade;
          if (fefo)
            avisos.push(
              `Validade inferior ao estoque (validade mais proxima ja ocupada: ${fefo.split("-").reverse().join("/")}). Priorize a saida deste primeiro (FEFO).`,
            );
          movements.push(
            await this.leg(
              c,
              op,
              actor,
              "ENTRADA",
              op.endereco_id!,
              quantity,
              1,
              settings.allow_same_expiry,
            ),
          );
        } else if (op.tipo === "SAIDA")
          movements.push(
            await this.leg(
              c,
              op,
              actor,
              "SAIDA",
              op.endereco_id!,
              quantity,
              -1,
              false,
            ),
          );
        else if (op.tipo === "TRANSFERENCIA") {
          const transfer = randomUUID();
          movements.push(
            await this.leg(
              c,
              op,
              actor,
              "TRANSFERENCIA_SAIDA",
              op.endereco_id!,
              quantity,
              -1,
              false,
              transfer,
            ),
          );
          movements.push(
            await this.leg(
              c,
              op,
              actor,
              "TRANSFERENCIA_ENTRADA",
              op.destino_id!,
              quantity,
              1,
              settings.allow_same_expiry,
              transfer,
            ),
          );
        } else {
          const current =
            (
              await c.query(
                `SELECT quantidade FROM wms_balances WHERE endereco_id=$1 AND produto_id=$2 AND validade=$3 FOR UPDATE`,
                [op.endereco_id, op.produto_id, op.validade],
              )
            ).rows[0]?.quantidade || 0;
          const delta = quantity - current;
          if (delta)
            movements.push(
              await this.leg(
                c,
                op,
                actor,
                "AJUSTE_INVENTARIO",
                op.endereco_id!,
                Math.abs(delta),
                delta > 0 ? 1 : -1,
                true,
              ),
            );
          else
            await audit(
              c,
              actor,
              "CONTAGEM_SEM_DIFERENCA",
              op.endereco_id!,
              { quantidade: current },
              { quantidade: quantity },
            );
        }
      }
      const response = { movimentos: movements, avisos };
      await c.query(
        "INSERT INTO wms_operations(id,operador_id,fingerprint,response) VALUES($1,$2,$3,$4)",
        [op.request_id, actor.id, fingerprint, JSON.stringify(response)],
      );
      return response;
    });
  }
  private async lockAddresses(c: PoolClient, ids: string[]) {
    const sorted = [...new Set(ids)].sort();
    const result = await c.query(
      "SELECT id FROM wms_addresses WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [sorted],
    );
    if (result.rowCount !== sorted.length)
      throw new HttpError(404, "Endereco nao encontrado.");
  }
  private async leg(
    c: PoolClient,
    op: StockOperation,
    actor: Actor,
    tipo: string,
    address: string,
    quantity: number,
    sign: number,
    allowSame: boolean,
    transfer?: string,
    reversed?: string,
  ) {
    if (sign > 0) {
      const blocked = (
        await c.query("SELECT bloqueado FROM wms_addresses WHERE id=$1", [
          address,
        ])
      ).rows[0].bloqueado;
      if (blocked) throw new HttpError(409, "Endereco bloqueado.");
      const occupied = (
        await c.query(
          "SELECT produto_id,validade::text FROM wms_balances WHERE endereco_id=$1 AND quantidade>0 FOR UPDATE",
          [address],
        )
      ).rows[0];
      if (
        occupied &&
        (!allowSame ||
          occupied.produto_id !== op.produto_id ||
          occupied.validade !== op.validade)
      )
        throw new HttpError(
          409,
          "Endereco ocupado. Escolha uma posicao vazia.",
        );
    }
    await c.query(
      `INSERT INTO wms_balances(endereco_id,produto_id,validade,quantidade) VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`,
      [address, op.produto_id, op.validade],
    );
    const before = (
      await c.query(
        "SELECT quantidade FROM wms_balances WHERE endereco_id=$1 AND produto_id=$2 AND validade=$3 FOR UPDATE",
        [address, op.produto_id, op.validade],
      )
    ).rows[0].quantidade;
    const after = before + quantity * sign;
    if (after < 0)
      throw new HttpError(409, `Saldo insuficiente. Saldo atual: ${before}.`);
    if (after > 2147483647) throw new HttpError(422, "Saldo excede o limite.");
    await c.query(
      "UPDATE wms_balances SET quantidade=$4 WHERE endereco_id=$1 AND produto_id=$2 AND validade=$3",
      [address, op.produto_id, op.validade, after],
    );
    const movement = (
      await c.query(
        `INSERT INTO wms_movements(tipo,produto_id,endereco_id,quantidade,sinal,validade,lote,ean_lido,operador_id,observacao,transferencia_id,estorno_de_id,operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *,validade::text`,
        [
          tipo,
          op.produto_id,
          address,
          quantity,
          sign,
          op.validade,
          op.lote || null,
          op.ean_lido ? normalizarEan(op.ean_lido) : null,
          actor.id,
          op.observacao,
          transfer || null,
          reversed || null,
          op.request_id,
        ],
      )
    ).rows[0] as Movement;
    await audit(
      c,
      actor,
      tipo,
      movement.id,
      {
        endereco_id: address,
        produto_id: op.produto_id,
        validade: op.validade,
        quantidade: before,
      },
      { ...movement, saldo: after },
    );
    return movement;
  }
  private async reverse(
    c: PoolClient,
    op: StockOperation,
    actor: Actor,
    movements: Movement[],
  ) {
    const original = (
      await c.query("SELECT *,validade::text FROM wms_movements WHERE id=$1", [
        op.movimento_id,
      ])
    ).rows[0] as Movement | undefined;
    if (!original) throw new HttpError(404, "Movimento nao encontrado.");
    if (original.tipo === "ESTORNO")
      throw new HttpError(409, "Nao e permitido estornar um estorno.");
    const originals: Movement[] = original.transferencia_id
      ? (
          await c.query(
            "SELECT *,validade::text FROM wms_movements WHERE transferencia_id=$1 AND tipo<>'ESTORNO' ORDER BY id FOR UPDATE",
            [original.transferencia_id],
          )
        ).rows
      : (
          await c.query(
            "SELECT *,validade::text FROM wms_movements WHERE id=$1 FOR UPDATE",
            [original.id],
          )
        ).rows;
    if (original.transferencia_id && originals.length !== 2)
      throw new HttpError(409, "Transferencia incompleta; confira a migracao.");
    if (
      (
        await c.query(
          "SELECT id FROM wms_movements WHERE estorno_de_id=ANY($1::uuid[])",
          [originals.map((m) => m.id)],
        )
      ).rowCount
    )
      throw new HttpError(409, "Movimento ja estornado.");
    await this.lockAddresses(
      c,
      originals.map((m) => m.endereco_id),
    );
    const transfer = original.transferencia_id ? randomUUID() : undefined;
    for (const m of originals.sort((a, b) => b.sinal - a.sinal)) {
      movements.push(
        await this.leg(
          c,
          {
            ...op,
            produto_id: m.produto_id,
            validade: m.validade,
            lote: m.lote || undefined,
            ean_lido: m.ean_lido || undefined,
          },
          actor,
          "ESTORNO",
          m.endereco_id,
          m.quantidade,
          -m.sinal,
          true,
          transfer,
          m.id,
        ),
      );
    }
  }
}
