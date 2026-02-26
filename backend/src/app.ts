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
import { uploadsDir } from "./services/uploads.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/uploads", express.static(path.resolve(uploadsDir)));
app.use("/auth", authRouter);
app.use("/imports", importsRouter);
app.use("/kpi", kpiRouter);
app.use("/users", usersRouter);
app.use("/descents", descentsRouter);
app.use("/errors", errorsRouter);

app.use(errorHandler);
