import { Router } from "express";
import { z } from "zod";
import XLSX from "xlsx";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest, requireScreenAccess } from "../middleware/auth.js";
import { imageUpload } from "../services/uploads.js";
import { writeAuditLog } from "../services/audit.js";

const boolLike = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (!value) return false;
    return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "sim";
  });

const createSchema = z.object({
  workDate: z.string().min(1),
  loaderUserName: z.string().min(1).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  stopsCount: z.coerce.number().int().min(0).optional(),
  pauseMinutes: z.coerce.number().int().min(0).optional(),
  pauseReason: z.string().optional(),
  palletsCount: z.coerce.number().int().min(0).optional(),
  loadValue: z.coerce.number().min(0).optional(),
  volume: z.coerce.number().int().min(0).optional(),
  weightKg: z.coerce.number().min(0).optional(),
  isoporQty: z.coerce.number().int().min(0).optional(),
  hasHelper: boolLike,
  helperName: z.string().optional(),
  pauseEvents: z.string().optional(),
  notes: z.string().optional(),
  externalRef: z.string().optional()
});

const listSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  user: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
  export: z.enum(["xlsx"]).optional()
});

function normalizeDate(value: string): string {
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return value;
}

function toMinutes(time: string | undefined | null): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function computeDuration(startTime?: string, endTime?: string, pauseMinutes = 0): number | null {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return null;
  const raw = end >= start ? end - start : end + 24 * 60 - start;
  return Math.max(0, raw - pauseMinutes);
}

export const montagemSpRouter = Router();

montagemSpRouter.get("/helpers", authRequired, requireScreenAccess("montagem-sp"), async (_req, res) => {
  const result = await pool.query(
    `
      SELECT id, name
      FROM users
      WHERE is_active = true
        AND role <> 'admin'
      ORDER BY name
    `
  );
  return res.json({ items: result.rows });
});

montagemSpRouter.post(
  "/",
  authRequired,
  requireScreenAccess("montagem-sp"),
  imageUpload.single("photo"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Payload invalido." });
    if (!req.user) return res.status(401).json({ message: "Nao autenticado." });

    const data = parsed.data;
    const hasHelper = Boolean(data.hasHelper);
    if (hasHelper && !data.helperName?.trim()) {
      return res.status(400).json({ message: "Selecione o ajudante." });
    }

    let pauseReason = data.pauseReason?.trim() || "";
    if (data.pauseEvents) {
      try {
        const parsedEvents = JSON.parse(data.pauseEvents) as Array<{ start: string; end: string; reason: string; minutes: number }>;
        if (Array.isArray(parsedEvents) && parsedEvents.length) {
          pauseReason = parsedEvents
            .map((event) => `${event.start} - ${event.end} (${event.minutes} min): ${event.reason}`.trim())
            .join(" | ");
        }
      } catch {
        // Keeps pauseReason fallback if pauseEvents payload is invalid JSON.
      }
    }

    const durationMinutes = computeDuration(data.startTime, data.endTime, data.pauseMinutes || 0);

    const result = await pool.query(
      `
        INSERT INTO montagem_sp (
          external_ref, work_date, loader_user_name, start_time, end_time, duration_minutes,
          stops_count, pause_minutes, pause_reason, pallets_count, load_value, volume, weight_kg,
          isopor_qty, has_helper, helper_name, photo_path, notes, created_by_user_id
        )
        VALUES (
          $1, $2::date, $3, $4::time, $5::time, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19
        )
        RETURNING *
      `,
      [
        data.externalRef || null,
        normalizeDate(data.workDate),
        data.loaderUserName || req.user.name,
        data.startTime || null,
        data.endTime || null,
        durationMinutes,
        data.stopsCount || 0,
        data.pauseMinutes || 0,
        pauseReason || null,
        data.palletsCount ?? null,
        data.loadValue ?? null,
        data.volume ?? null,
        data.weightKg ?? null,
        data.isoporQty ?? null,
        hasHelper,
        hasHelper ? data.helperName || null : null,
        req.file ? `/uploads/${req.file.filename}` : null,
        data.notes || null,
        req.user.id
      ]
    );

    await writeAuditLog({
      userId: req.user.id,
      action: "MONTAGEM_SP_CREATE",
      meta: { id: result.rows[0].id, loader: data.loaderUserName || req.user.name }
    });

    return res.status(201).json(result.rows[0]);
  }
);

montagemSpRouter.get("/", authRequired, requireScreenAccess("montagem-sp"), async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Query invalida." });

  const { from, to, user, page, pageSize, export: exportType } = parsed.data;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (from) {
    values.push(normalizeDate(from));
    filters.push(`m.work_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(normalizeDate(to));
    filters.push(`m.work_date <= $${values.length}::date`);
  }
  if (user) {
    values.push(`%${user}%`);
    filters.push(`m.loader_user_name ILIKE $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  if (exportType === "xlsx") {
    const exportRows = await pool.query(
      `
        SELECT
          m.work_date, m.loader_user_name, m.start_time, m.end_time, m.duration_minutes,
          m.stops_count, m.pause_minutes, m.pause_reason, m.pallets_count, m.load_value,
          m.volume, m.weight_kg, m.isopor_qty, m.has_helper, m.helper_name, m.notes
        FROM montagem_sp m
        ${where}
        ORDER BY m.work_date DESC, m.created_at DESC
      `,
      values
    );

    const worksheetRows = exportRows.rows.map((r) => ({
      Data: r.work_date?.toISOString?.().slice(0, 10) ?? String(r.work_date ?? ""),
      Usuario: r.loader_user_name,
      HoraInicio: r.start_time ?? "",
      HoraTermino: r.end_time ?? "",
      TempoMin: r.duration_minutes ?? "",
      Paradas: r.stops_count ?? 0,
      ParadaMin: r.pause_minutes ?? 0,
      MotivoParada: r.pause_reason ?? "",
      Paletes: r.pallets_count ?? "",
      ValorCarga: r.load_value ?? "",
      Volume: r.volume ?? "",
      PesoKG: r.weight_kg ?? "",
      Isopor: r.isopor_qty ?? "",
      TeveAjudante: r.has_helper ? "SIM" : "NAO",
      Ajudante: r.helper_name ?? "",
      Observacoes: r.notes ?? ""
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(worksheetRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "MontagemSP");
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=montagem_sp.xlsx");
    return res.status(200).send(file);
  }

  const offset = (page - 1) * pageSize;
  const listValues = [...values, pageSize, offset];
  const items = await pool.query(
    `
      SELECT m.*
      FROM montagem_sp m
      ${where}
      ORDER BY m.work_date DESC, m.created_at DESC
      LIMIT $${listValues.length - 1} OFFSET $${listValues.length}
    `,
    listValues
  );

  const summary = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total_registros,
        COALESCE(SUM(volume), 0)::int AS total_volume,
        COALESCE(SUM(weight_kg), 0)::numeric(10,2) AS total_peso,
        COALESCE(SUM(isopor_qty), 0)::int AS total_isopor,
        COALESCE(SUM(pause_minutes), 0)::int AS total_parada_min
      FROM montagem_sp m
      ${where}
    `,
    values
  );

  return res.json({
    items: items.rows,
    summary: summary.rows[0],
    page,
    pageSize
  });
});
