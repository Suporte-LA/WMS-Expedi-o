import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";

export const uploadsDir = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  }
});

export const imageUpload = multer({ storage });
