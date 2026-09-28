import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { SafeUser, UserRole, Workspace } from "../types.js";
import { pool } from "../db.js";
import { supportsWorkspaceColumn } from "../services/workspaceSupport.js";

export type AuthenticatedRequest = Request & {
  user?: SafeUser;
};

type TokenPayload = {
  sub: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  pen_color?: string;
  workspace?: Workspace;
};

type ScreenKey = "dashboard" | "descents" | "error-check" | "error-reports" | "imports" | "users" | "montagem-sp";

const DEFAULT_SCREEN_ACCESS: Record<UserRole, Record<ScreenKey, boolean>> = {
  admin: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: true,
    users: true,
    "montagem-sp": true
  },
  supervisor: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: true,
    users: true,
    "montagem-sp": true
  },
  operator: {
    dashboard: false,
    descents: true,
    "error-check": false,
    "error-reports": false,
    imports: false,
    users: false,
    "montagem-sp": true
  },
  conferente: {
    dashboard: false,
    descents: false,
    "error-check": true,
    "error-reports": false,
    imports: false,
    users: false,
    "montagem-sp": false
  }
};

export async function authRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ message: "Token ausente." });
  let payload: TokenPayload;
  try {
    payload = jwt.verify(authHeader.slice(7).trim(), config.jwtSecret, { algorithms: ["HS256"] }) as TokenPayload;
    if (!payload.sub || typeof payload.sub !== "string") throw new Error("Invalid subject");
  } catch {
    return res.status(401).json({ message: "Token invalido." });
  }
  try {
    const hasWorkspace = await supportsWorkspaceColumn();
    const result = await pool.query(
      `SELECT id, name, email, role, is_active, pen_color, ${hasWorkspace ? "workspace" : "'expedicao'::text AS workspace"} FROM users WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "Sessao invalida." });
    if (!user.is_active) return res.status(403).json({ message: "Usuario desativado." });
    req.user = { ...user, pen_color: user.pen_color ?? "", workspace: user.workspace ?? "expedicao" };
    return next();
  } catch {
    return res.status(503).json({ message: "Nao foi possivel validar a sessao. Tente novamente." });
  }
}

export function requireRole(roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Não autenticado." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Permissão insuficiente." });
    }
    return next();
  };
}

export function requireScreenAccess(screen: ScreenKey) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Nao autenticado." });
    }

    const fallback = DEFAULT_SCREEN_ACCESS[req.user.role][screen];

    try {
      const table = await pool.query(`SELECT to_regclass('public.role_screen_permissions') AS table_name`);
      if (!table.rows[0]?.table_name) {
        if (!fallback) return res.status(403).json({ message: "Permissao insuficiente." });
        return next();
      }

      const allowed = await pool.query(
        `
          SELECT is_enabled
          FROM role_screen_permissions
          WHERE role = $1::role_type AND screen_key = $2
          LIMIT 1
        `,
        [req.user.role, screen]
      );

      const isEnabled = allowed.rowCount ? Boolean(allowed.rows[0].is_enabled) : fallback;
      if (!isEnabled) {
        return res.status(403).json({ message: "Permissao insuficiente." });
      }
      return next();
    } catch {
      return res.status(503).json({ message: "Nao foi possivel validar as permissoes." });
    }
  };
}
