import cors from "cors";
import express from "express";
import path from "path";
import { authRouter } from "./routes/auth.js";
import { importsRouter } from "./routes/imports.js";
import { kpiRouter } from "./routes/kpi.js";
import { usersRouter } from "./routes/users.js";
import { errorHandler } from "./middleware/error.js";
import { descentsRouter } from "./routes/descents.js";
import { errorsRouter } from "./routes/errors.js";
import { settingsRouter } from "./routes/settings.js";
import { montagemSpRouter } from "./routes/montagemSp.js";
import { additionalUploadsDirs, uploadsDir } from "./services/uploads.js";

import { stockEnabled } from "./services/availableWorkspaces.js";

export const app = express();

app.disable("x-powered-by");
// Only enable when the API is reachable exclusively through a trusted proxy.
if (process.env.TRUST_PROXY_HOPS) app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/uploads", express.static(path.resolve(uploadsDir), { setHeaders: (res) => res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox") }));
for (const dir of additionalUploadsDirs) {
  app.use("/uploads", express.static(path.resolve(dir), { setHeaders: (res) => res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox") }));
}
app.use("/auth", authRouter);
app.use("/imports", importsRouter);
app.use("/kpi", kpiRouter);
app.use("/users", usersRouter);
app.use("/descents", descentsRouter);
app.use("/errors", errorsRouter);
app.use("/settings", settingsRouter);
app.use("/montagem-sp", montagemSpRouter);
if (stockEnabled) {
  const { stockRouter } = await import("./routes/stock.js");
  app.use("/stock", stockRouter);
}

app.use(errorHandler);
