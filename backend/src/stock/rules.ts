import { z } from "zod";

import { normalizarEan } from "@wms/stock-domain";
export { normalizarEan, validarEan } from "@wms/stock-domain";
export const addressSchema = z
  .object({
    galpao: z.coerce.number().int().min(1).max(9),
    rua: z.coerce.number().int().min(1).max(99),
    coluna: z.coerce.number().int().min(1).max(99),
    nivel: z.coerce.number().int().min(0).max(99),
    posicao: z.coerce.number().int().min(1).max(99),
    bloqueado: z.boolean().default(false),
    motivo_bloqueio: z.string().trim().max(500).default(""),
  })
  .refine(
    (a) => !a.bloqueado || a.motivo_bloqueio.length > 0,
    "Informe o motivo do bloqueio.",
  );
export function codigoEndereco(
  a: Pick<
    z.infer<typeof addressSchema>,
    "galpao" | "rua" | "coluna" | "nivel" | "posicao"
  >,
) {
  return (
    String(a.galpao) +
    [a.rua, a.coluna, a.nivel, a.posicao]
      .map((n) => String(n).padStart(2, "0"))
      .join("")
  );
}
export function decomporEndereco(codigo: string) {
  if (!/^\d{9}$/.test(codigo)) throw new Error("Endereco deve ter 9 digitos.");
  return addressSchema.parse({
    galpao: codigo[0],
    rua: codigo.slice(1, 3),
    coluna: codigo.slice(3, 5),
    nivel: codigo.slice(5, 7),
    posicao: codigo.slice(7, 9),
  });
}
export const productSchema = z.object({
  codigo: z.string().trim().min(1).max(80),
  descricao: z.string().trim().min(2).max(300),
  ean_unidade: z
    .string()
    .transform(normalizarEan)
    .pipe(z.string().min(1).max(32)),
  ean_caixa: z
    .string()
    .max(100)
    .transform((v) => normalizarEan(v) || null)
    .nullable()
    .optional(),
  fornecedor: z.string().trim().max(200).default(""),
  qtd_unitario: z.coerce.number().int().min(1).default(1),
  qtd_na_caixa: z.coerce.number().int().min(1).default(1),
  peso: z.coerce.number().min(0).max(999999999999).default(0),
  endereco_padrao_id: z.string().uuid().nullable().optional(),
  ativo: z.boolean().default(true),
});
export const operationSchema = z
  .object({
    request_id: z.string().uuid(),
    tipo: z.enum([
      "ENTRADA",
      "SAIDA",
      "TRANSFERENCIA",
      "AJUSTE_INVENTARIO",
      "ESTORNO",
    ]),
    produto_id: z.string().uuid().optional(),
    endereco_id: z.string().uuid().optional(),
    destino_id: z.string().uuid().optional(),
    quantidade: z.coerce.number().int().min(0).max(2147483647).optional(),
    validade: z.string().date().optional(),
    ean_lido: z.string().max(100).optional(),
    caixas: z.boolean().default(false),
    lote: z.string().max(120).optional(),
    observacao: z.string().trim().max(1000).default(""),
    movimento_id: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "ESTORNO") {
      if (!v.movimento_id)
        ctx.addIssue({ code: "custom", message: "Informe o movimento." });
    } else if (
      !v.produto_id ||
      !v.endereco_id ||
      !v.validade ||
      v.quantidade === undefined ||
      (v.tipo !== "AJUSTE_INVENTARIO" && v.quantidade < 1)
    )
      ctx.addIssue({
        code: "custom",
        message: "Informe produto, endereco, validade e quantidade valida.",
      });
    if (
      v.tipo === "TRANSFERENCIA" &&
      (!v.destino_id || v.destino_id === v.endereco_id)
    )
      ctx.addIssue({
        code: "custom",
        message: "O destino deve ser diferente da origem.",
      });
    if (
      ["ESTORNO", "AJUSTE_INVENTARIO"].includes(v.tipo) &&
      v.observacao.length < 3
    )
      ctx.addIssue({
        code: "custom",
        message: "Motivo obrigatorio (minimo 3 caracteres).",
      });
  });
export type StockOperation = z.infer<typeof operationSchema>;
