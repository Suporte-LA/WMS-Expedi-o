import { pool } from "../db.js";

type AuditAction =
  | "LOGIN"
  | "IMPORT_CREATE"
  | "IMPORT_SUCCESS"
  | "IMPORT_FAIL"
  | "USER_CREATE"
  | "USER_UPDATE"
  | "DESCENT_CREATE"
  | "DAILY_DOCK_ASSIGNMENT_UPSERT"
  | "DAILY_DOCK_ASSIGNMENT_DELETE"
  | "FROZEN_ORDER_CLASSIFY"
  | "FROZEN_ORDER_UNCLASSIFY"
  | "ERROR_CREATE"
  | "SETTINGS_ACCESS_UPDATE"
  | "MONTAGEM_SP_CREATE"
  | "MONTAGEM_SP_UPDATE";

export async function writeAuditLog(params: {
  userId?: string | null;
  action: AuditAction;
  meta?: Record<string, unknown>;
}) {
  await pool.query(
    `
      INSERT INTO audit_log (user_id, action, meta)
      VALUES ($1, $2, $3::jsonb)
    `,
    [params.userId ?? null, params.action, JSON.stringify(params.meta ?? {})]
  );
}
