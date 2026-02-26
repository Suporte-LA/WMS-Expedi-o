import { parse } from "csv-parse/sync";
import { createHash } from "crypto";
import XLSX from "xlsx";
import { z } from "zod";

const rowSchema = z.object({
  user_name: z.string().min(1),
  work_date: z.date(),
  orders_count: z.coerce.number().int().min(0),
  boxes_count: z.coerce.number().int().min(0),
  weight_kg: z.preprocess((v) => {
    if (typeof v === "string") return v.replace(",", ".");
    return v;
  }, z.coerce.number().min(0))
});

export type KpiRow = z.infer<typeof rowSchema>;

export type OrderCatalogRow = {
  order_number: string;
  lot: string | null;
  volume: number | null;
  weight_kg: number | null;
  route: string | null;
  description: string | null;
  base_date: Date | null;
};

type ParseParams = {
  filename: string;
  fileBuffer: Buffer;
  sheetName?: string;
};

const aliases: Record<keyof KpiRow, string[]> = {
  user_name: ["usuario", "user", "user_name", "nome"],
  work_date: ["data", "date", "work_date"],
  orders_count: ["pedidos", "pedidos_dia", "orders", "orders_count"],
  boxes_count: ["volume", "caixas", "quantidades_dia", "boxes", "boxes_count"],
  weight_kg: ["peso", "kg", "weight", "weight_kg"]
};

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function mapHeaders(source: Record<string, unknown>): Record<keyof KpiRow, unknown> {
  const normalizedSource: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    normalizedSource[normalizeKey(key)] = value;
  });

  const mapped = {} as Record<keyof KpiRow, unknown>;
  (Object.keys(aliases) as (keyof KpiRow)[]).forEach((target) => {
    const found = aliases[target].find((candidate) => normalizedSource[candidate] !== undefined);
    mapped[target] = found ? normalizedSource[found] : undefined;
  });
  return mapped;
}

function hasRequiredColumns(headerValues: unknown[]): boolean {
  const normalized = headerValues
    .filter((v): v is string => typeof v === "string")
    .map((v) => normalizeKey(v));

  return (Object.keys(aliases) as (keyof KpiRow)[]).every((target) =>
    aliases[target].some((candidate) => normalized.includes(candidate))
  );
}

function detectBestSheet(workbook: XLSX.WorkBook, requestedSheet?: string): string {
  if (requestedSheet) {
    const sheet = workbook.Sheets[requestedSheet];
    if (!sheet) throw new Error(`Aba '${requestedSheet}' nao encontrada.`);
    return requestedSheet;
  }

  const preferred = ["Externos", "Rendimentos", "Copia de Rendimentos", "Cópia de Rendimentos"];
  for (const name of preferred) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const header = rows[0] ?? [];
    if (hasRequiredColumns(header)) return name;
  }

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const header = rows[0] ?? [];
    if (hasRequiredColumns(header)) return name;
  }

  throw new Error("Nenhuma aba com colunas KPI encontradas (Usuario, Data, Pedidos, Volume, Peso).");
}

function parseDateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const dt = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]) - 1;
    const year = Number(brMatch[3]);
    const date = new Date(Date.UTC(year, month, day));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;
  return undefined;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeOrderNumber(value: string): string {
  const onlyDigits = value.replace(/\D/g, "");
  return onlyDigits || value;
}

function normalizeNullableInt(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const num = Number(String(value).replace(",", "."));
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const num = Number(String(value).replace(",", "."));
  if (!Number.isFinite(num)) return null;
  return num;
}

export function parseOrderCatalogFile({ filename, fileBuffer }: Omit<ParseParams, "sheetName">) {
  const lowerName = filename.toLowerCase();
  let rows: Record<string, unknown>[] = [];

  if (lowerName.endsWith(".csv")) {
    rows = parse(fileBuffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true
    }) as Record<string, unknown>[];
  } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const preferred = ["Base", "BASE", "Pedidos Base"];
    let selected = preferred.find((name) => workbook.Sheets[name]);

    if (!selected) {
      selected = workbook.SheetNames.find((name) => {
        const sheet = workbook.Sheets[name];
        const head = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })[0] ?? [];
        const norm = head.filter((v): v is string => typeof v === "string").map((v) => normalizeKey(v));
        return norm.includes("pedido") && norm.includes("lote");
      });
    }
    if (!selected) return [];

    const sheet = workbook.Sheets[selected];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } else {
    return [];
  }

  const output: OrderCatalogRow[] = [];
  for (const row of rows) {
    const normalized: Record<string, unknown> = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeKey(key)] = value;
    });

    const order = normalizeNullableString(normalized["pedido"] ?? normalized["order"] ?? normalized["order_number"]);
    if (!order) continue;

    output.push({
      order_number: normalizeOrderNumber(order),
      lot: normalizeNullableString(normalized["lote"] ?? normalized["lot"]),
      volume: normalizeNullableInt(normalized["volume"] ?? normalized["vol"] ?? normalized["quantidade"]),
      weight_kg: normalizeNullableNumber(normalized["peso"] ?? normalized["kg"] ?? normalized["weight"]),
      route: normalizeNullableString(normalized["rota"] ?? normalized["route"]),
      description: normalizeNullableString(normalized["descricao"] ?? normalized["description"]),
      base_date: parseDateValue(normalized["data"] ?? normalized["date"]) ?? null
    });
  }

  const dedup = new Map<string, OrderCatalogRow>();
  output.forEach((item) => {
    if (!dedup.has(item.order_number)) {
      dedup.set(item.order_number, item);
    }
  });
  return [...dedup.values()];
}

export function parseKpiFile({ filename, fileBuffer, sheetName }: ParseParams) {
  const lowerName = filename.toLowerCase();
  let rows: Record<string, unknown>[] = [];

  if (lowerName.endsWith(".csv")) {
    const csvRows = parse(fileBuffer.toString("utf-8"), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true
    }) as Record<string, unknown>[];
    rows = csvRows;
  } else if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const selected = detectBestSheet(workbook, sheetName);
    const sheet = workbook.Sheets[selected];
    if (!sheet) throw new Error(`Aba '${selected}' nao encontrada.`);
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } else {
    throw new Error("Formato invalido. Envie CSV ou XLSX.");
  }

  const rejectionReasons: string[] = [];
  const validRows: KpiRow[] = [];

  rows.forEach((row, idx) => {
    const mapped = mapHeaders(row);
    const isEmptyRow = Object.values(mapped).every((v) => v === undefined || v === null || String(v).trim() === "");
    if (isEmptyRow) return;

    mapped.work_date = parseDateValue(mapped.work_date);
    const parsed = rowSchema.safeParse(mapped);
    if (!parsed.success) {
      rejectionReasons.push(`Linha ${idx + 2}: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    validRows.push(parsed.data);
  });

  return {
    rows: validRows,
    rejectionReasons,
    preview: rows.slice(0, 20),
    fileHash: createHash("sha256").update(fileBuffer).digest("hex")
  };
}
