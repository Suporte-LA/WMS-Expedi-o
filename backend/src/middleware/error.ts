import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { HttpError } from "../services/httpError.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return _next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err instanceof multer.MulterError) return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: "Arquivo ou formulario excede os limites permitidos." });
  if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ message: "JSON invalido." });
  if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large") return res.status(413).json({ message: "Requisicao muito grande." });
  // Avoid logging tokens, request bodies, SQL parameters or database credentials.
  console.error("API request failed", { method: _req.method, path: _req.path, type: err instanceof Error ? err.name : "UnknownError" });
  return res.status(500).json({ message: "Erro interno." });
}
