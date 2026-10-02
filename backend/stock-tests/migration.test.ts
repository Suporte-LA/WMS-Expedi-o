import { it, expect } from "vitest";
import { planSheets, type Sheets } from "../src/stock/migration.js";
const base = (): Sheets => ({
  Cadastro: [
    {
      codigo: "P1",
      descricao: "Produto teste",
      ean_unidade: "7891234567895",
      ean_caixa: "17891234567892",
    },
  ],
  Ocupacao: [
    { endereco: "101010101", status: "Ocupado", local: "RUA  01 A" },
    { endereco: "101080101", status: "Vazio", local: "RUA 01" },
  ],
  Estoque: [
    {
      codigo: "P1",
      endereco: "101010101",
      quantidade: 10,
      validade: "31/01/2027",
      nome: "Operador legado",
      data: "01/10/2026",
      tipo: "ENTRADA",
    },
  ],
  Lancamento: [],
});
it("normaliza cabeçalhos e preserva datas/autoria, saldo e local derivado", () => {
  const s = base();
  s.Ocupacao[0]["Rua_16"] = "coluna ignorada";
  const p = planSheets(s);
  expect(p.report.errors).toEqual([]);
  expect(p.balances[0].quantidade).toBe(10);
  expect(p.movements[0].validade).toBe("2027-01-31");
  expect(p.movements[0].operador).toBe("Operador legado");
  expect(p.addresses[1].coluna).toBe(8);
});
it("reporta duplicados entre EAN de unidade e de caixa", () => {
  const s = base();
  s.Cadastro.push({
    codigo: "P2",
    descricao: "Duplicado",
    ean_unidade: "17891234567892",
  });
  expect(planSheets(s).report.errors[0].erro).toContain("EAN");
});
it("pareia transferencia parcial apenas com saida inequivoca", () => {
  const s = base();
  s.Estoque.push({
    ...s.Estoque[0],
    tipo: "AJUSTE",
    endereco: "101080101",
    endereco_origem: "101010101",
    quantidade: 4,
    transferencia_id: "T1",
  });
  s.Lancamento.push({
    ...s.Estoque[0],
    tipo: "SAIDA",
    quantidade: 4,
    transferencia_id: "T1",
  });
  const p = planSheets(s);
  expect(p.report.transferencias_incompletas).toEqual([]);
  expect(p.balances.map((b) => b.quantidade)).toEqual([6, 4]);
  expect(
    p.movements
      .filter((m) => m.tipo.startsWith("TRANSFERENCIA"))
      .map((m) => m.transferencia),
  ).toEqual(["par:Estoque:3", "par:Estoque:3"]);
});
it("nao inventa saida ausente nem corrige transferencia de saldo inteiro", () => {
  const s = base();
  s.Estoque.push({
    ...s.Estoque[0],
    tipo: "AJUSTE",
    endereco: "101080101",
    endereco_origem: "101010101",
    quantidade: 4,
    transferencia_id: "T1",
  });
  expect(planSheets(s).report.transferencias_incompletas).toHaveLength(1);
  s.Lancamento.push({
    ...s.Estoque[0],
    tipo: "SAIDA",
    quantidade: 10,
    transferencia_id: "T1",
  });
  expect(
    planSheets(s).report.transferencias_incompletas.length,
  ).toBeGreaterThan(0);
});
it("relata negativos sem altera-los e muda hash quando CSV muda", () => {
  const s = base();
  s.Lancamento.push({ ...s.Estoque[0], tipo: "SAIDA", quantidade: 11 });
  const p = planSheets(s);
  expect(p.report.negativos[0].quantidade).toBe(-1);
  expect(p.report.divergencias_status).toHaveLength(1);
  s.Lancamento[0].quantidade = 12;
  expect(planSheets(s).fingerprint).not.toBe(p.fingerprint);
});
it("bloqueia datas invalidas e ocupacao com validades diferentes", () => {
  const s = base();
  s.Estoque.push({ ...s.Estoque[0], validade: "31/02/2027" });
  expect(planSheets(s).report.errors).toHaveLength(1);
  s.Estoque[1].validade = "28/02/2027";
  expect(planSheets(s).report.multiplos_produtos_ou_validades).toHaveLength(1);
});
