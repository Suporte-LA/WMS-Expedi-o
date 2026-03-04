import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const servicesDir = path.dirname(currentFilePath);
const backendRootDir = path.resolve(servicesDir, "..", "..");
const legacyRootUploadsDir = path.resolve(process.cwd(), "uploads");

export const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(backendRootDir, "uploads");

export const additionalUploadsDirs = [legacyRootUploadsDir].filter((dir) => path.resolve(dir) !== path.resolve(uploadsDir));

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
