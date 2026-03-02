import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { SafeUser, UserRole } from "../types.js";
import { pool } from "../db.js";

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
};

type ScreenKey = "dashboard" | "descents" | "error-check" | "error-reports" | "imports" | "users";

const DEFAULT_SCREEN_ACCESS: Record<UserRole, Record<ScreenKey, boolean>> = {
  admin: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: true,
    users: true
  },
  supervisor: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: false,
    users: true
  },
  operator: {
    dashboard: false,
    descents: true,
    "error-check": false,
    "error-reports": false,
    imports: false,
    users: false
  },
  conferente: {
    dashboard: false,
    descents: false,
    "error-check": true,
    "error-reports": false,
    imports: false,
    users: false
  }
};

export function authRequired(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token ausente." });
  }

  const token = authHeader.replace("Bearer ", "").trim();
  try {
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    if (!payload.is_active) {
      return res.status(403).json({ message: "Usuário desativado." });
    }

    req.user = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      is_active: payload.is_active,
      pen_color: payload.pen_color ?? ""
    };
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Token inválido." });
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
      if (!fallback) {
        return res.status(403).json({ message: "Permissao insuficiente." });
      }
      return next();
    }
  };
}
