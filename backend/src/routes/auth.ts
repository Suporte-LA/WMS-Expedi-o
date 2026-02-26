import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db.js";
import { authRequired, AuthenticatedRequest } from "../middleware/auth.js";
import { writeAuditLog } from "../services/audit.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload inválido." });
  }

  const { email, password } = parsed.data;
  const result = await pool.query(
    `SELECT id, name, email, role, is_active, pen_color, password_hash FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (!result.rowCount) {
    return res.status(401).json({ message: "Credenciais inválidas." });
  }

  const user = result.rows[0];
  if (!user.is_active) {
    return res.status(403).json({ message: "Usuário desativado." });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: "Credenciais inválidas." });
  }

  const token = jwt.sign(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      pen_color: user.pen_color
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"] }
  );

  await writeAuditLog({ userId: user.id, action: "LOGIN", meta: { email: user.email } });

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_active: user.is_active,
      pen_color: user.pen_color
    }
  });
});

authRouter.get("/me", authRequired, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Nao autenticado." });
  }
  const result = await pool.query(
    `
      SELECT id, name, email, role, is_active, pen_color
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [req.user.id]
  );
  if (!result.rowCount) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }
  return res.json({ user: result.rows[0] });
});
