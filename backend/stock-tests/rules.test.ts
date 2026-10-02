import { describe, it, expect } from "vitest";
import {
  normalizarEan,
  validarEan,
  decomporEndereco,
  codigoEndereco,
} from "../src/stock/rules.js";
describe("EAN e enderecamento", () => {
  it("normaliza UPC, espacos e caracteres uma unica vez", () => {
    expect(normalizarEan(" 0360-00291452 ")).toBe("0036000291452");
    expect(validarEan("036000291452")).toBe(true);
  });
  it("valida EAN-8/13/14 e rejeita digitos errados", () => {
    expect(validarEan("96385074")).toBe(true);
    expect(validarEan("7891234567895")).toBe(true);
    expect(validarEan("17891234567892")).toBe(true);
    expect(validarEan("7891234567890")).toBe(false);
    expect(validarEan("123")).toBe(false);
  });
  it("decompoe exatamente GRRCCNNPP", () => {
    const a = decomporEndereco("101070201");
    expect(a).toMatchObject({
      galpao: 1,
      rua: 1,
      coluna: 7,
      nivel: 2,
      posicao: 1,
    });
    expect(codigoEndereco(a)).toBe("101070201");
  });
});
