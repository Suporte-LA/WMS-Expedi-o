import XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import { HttpError } from "../services/httpError.js";

export function normalizedKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
export function readRows(
  buffer: Buffer,
  filename: string,
  sheet?: string,
): Record<string, unknown>[] {
  let rows: Record<string, unknown>[];
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = buffer.toString("utf8");
    rows = parse(text, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: text.split(/\r?\n/)[0].includes(";") ? ";" : ",",
    });
  } else if (/\.xlsx?$/i.test(filename)) {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,
      sheetRows: 10002,
    });
    const name = sheet || workbook.SheetNames[0];
    if (!workbook.Sheets[name])
      throw new HttpError(422, `Aba nao encontrada: ${name}`);
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      defval: "",
      raw: false,
    });
  } else throw new HttpError(415, "Envie CSV, XLS ou XLSX.");
  if (rows.length > 10000)
    throw new HttpError(422, "Importe no maximo 10.000 linhas por arquivo.");
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [normalizedKey(key), value]),
    ),
  );
}
export function productFromRow(row: Record<string, unknown>) {
  const numeric = (v: unknown, fallback: number) =>
    v === "" || v === undefined
      ? fallback
      : Number(String(v).replace(",", "."));
  return {
    codigo: String(row.codigo ?? row.codigo_produto ?? row.cod ?? ""),
    descricao: String(row.descricao ?? row.produto ?? ""),
    ean_unidade: String(row.ean_unidade ?? row.ean ?? row.codigo_barras ?? ""),
    ean_caixa: String(row.ean_caixa ?? row.dun14 ?? row.dun_14 ?? ""),
    fornecedor: String(row.fornecedor ?? ""),
    qtd_unitario: numeric(row.qtd_unitario, 1),
    qtd_na_caixa: numeric(row.qtd_na_caixa, 1),
    peso: numeric(row.peso, 0),
    ativo: !["false", "nao", "0", "inativo"].includes(
      normalizedKey(String(row.ativo ?? "true")),
    ),
    endereco_padrao_id: row.endereco_padrao_id
      ? String(row.endereco_padrao_id)
      : null,
  };
}
