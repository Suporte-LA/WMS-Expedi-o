import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { SafeUser, UserRole } from "../types.js";

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
