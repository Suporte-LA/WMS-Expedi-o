import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { pool } from "../src/db.js";

type Row = {
  submittedAt: Date;
  name: string;
  operation: string;
  maintenanceItem: string;
  phoneModel?: string | null;
  tabletModel?: string | null;
};

function toText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const asString = String(value).trim();
  const asDate = new Date(asString);
  if (!Number.isNaN(asDate.getTime())) return asDate;
  return null;
}

function pickSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  const preferred = ["Respostas ao formulário 2", "Formulario", "Formulário"];
  for (const name of preferred) {
    if (workbook.Sheets[name]) return workbook.Sheets[name];
  }
  return workbook.Sheets[workbook.SheetNames[0]] || null;
}

function parseFormRows(buffer: Buffer): Row[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = pickSheet(workbook);
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const parsed: Row[] = [];
  for (const row of rows) {
    const submittedAt =
      parseDate(row["Carimbo de data/hora"]) ||
      parseDate(row["Carimbo de data/hora "]) ||
      parseDate(row["Data"]) ||
      new Date();
    const operation = toText(row["Nome"]) || toText(row["Operação"]) || toText(row["Operacao"]);
    const name = toText(row["Nome.1"]) || toText(row["Nome completo"]) || operation;
    const maintenanceItem =
      toText(row["O que foi trocado"]) ||
      toText(row["Tipo de Manutenção"]) ||
      toText(row["Tipo de Manutencao"]) ||
      toText(row["Manutenção"]) ||
      toText(row["Manutencao"]);
    if (!operation || !maintenanceItem) continue;

    const model = toText(row["Modelo"]);
    const deviceHint = maintenanceItem.toLowerCase();
    const phoneModel = deviceHint.includes("tablet") ? "" : model;
    const tabletModel = deviceHint.includes("tablet") ? model : "";

    parsed.push({
      submittedAt,
      name,
      operation,
      maintenanceItem,
      phoneModel: phoneModel || null,
      tabletModel: tabletModel || null
    });
  }
  return parsed;
}

function parseMonthRows(buffer: Buffer): Row[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const parsed: Row[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) continue;

    const hasMonthlyCols = rows.some((row) => row["Data/Hora"] || row["Cod Vendedor"]);
    if (!hasMonthlyCols) continue;

    for (const row of rows) {
      const submittedAt = parseDate(row["Data/Hora"]) || parseDate(row["Data"]) || new Date();
      const operation = toText(row["Cod Vendedor"]) || toText(row["Operacao"]) || toText(row["Operação"]);
      const name = toText(row["Nome"]) || operation;
      const maintenanceItem =
        toText(row["Trocado"]) ||
        toText(row["Tipo"]) ||
        toText(row["Troca"]) ||
        toText(row["Tipo de Manutenção"]) ||
        toText(row["Manutenção"]);
      if (!operation || !maintenanceItem) continue;

      const rawModel = toText(row["Modelo"]) || toText(row["Modelos"]);
      const extraModel = toText(row["Unnamed: 10"]);
      const key = maintenanceItem.toLowerCase();
      let phoneModel = "";
      let tabletModel = "";

      if (key.includes("tablet")) {
        tabletModel = rawModel || extraModel;
      } else if (key.includes("celular")) {
        phoneModel = rawModel || extraModel;
      } else {
        phoneModel = rawModel;
        tabletModel = extraModel;
      }

      parsed.push({
        submittedAt,
        name,
        operation,
        maintenanceItem,
        phoneModel: phoneModel || null,
        tabletModel: tabletModel || null
      });
    }
  }

  return parsed;
}

async function insertRow(row: Row): Promise<boolean> {
  const result = await pool.query(
    `
      INSERT INTO ti_device_records (
        submitted_at,
        maintenance_item,
        name,
        operation,
        phone_model,
        tablet_model
      )
      SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (
        SELECT 1
        FROM ti_device_records
        WHERE submitted_at = $1
          AND maintenance_item = $2
          AND name = $3
          AND operation = $4
          AND COALESCE(phone_model, '') = COALESCE($5, '')
          AND COALESCE(tablet_model, '') = COALESCE($6, '')
      )
    `,
    [
      row.submittedAt,
      row.maintenanceItem,
      row.name,
      row.operation,
      row.phoneModel,
      row.tabletModel
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Uso: tsx scripts/import-ti-history.ts <CAMINHO_DO_XLSX>");
    process.exit(1);
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Arquivo nao encontrado: ${resolved}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(resolved);
  const formRows = parseFormRows(buffer);
  const monthRows = parseMonthRows(buffer);
  const rows = [...formRows, ...monthRows];
  console.log(`Linhas lidas: ${rows.length} (formulario ${formRows.length}, meses ${monthRows.length})`);

  let inserted = 0;
  for (const row of rows) {
    const ok = await insertRow(row);
    if (ok) inserted += 1;
  }

  console.log(`Inseridos: ${inserted}`);
  await pool.end();
}

run().catch(async (error) => {
  console.error("Erro ao importar TI:", error);
  await pool.end();
  process.exit(1);
});
