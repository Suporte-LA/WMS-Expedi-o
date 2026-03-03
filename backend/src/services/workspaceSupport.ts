import { pool } from "../db.js";

let cachedWorkspaceSupport: boolean | null = null;

export async function supportsWorkspaceColumn(): Promise<boolean> {
  if (cachedWorkspaceSupport !== null) return cachedWorkspaceSupport;
  try {
    const result = await pool.query(
      `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'workspace'
        LIMIT 1
      `
    );
    cachedWorkspaceSupport = (result.rowCount ?? 0) > 0;
    return cachedWorkspaceSupport;
  } catch {
    cachedWorkspaceSupport = false;
    return false;
  }
}
