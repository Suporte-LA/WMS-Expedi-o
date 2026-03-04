import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const currentFilePath = fileURLToPath(import.meta.url);
const servicesDir = path.dirname(currentFilePath);
const backendRootDir = path.resolve(servicesDir, "..", "..");
const legacyRootUploadsDir = path.resolve(process.cwd(), "uploads");

export const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(backendRootDir, "uploads");

export const additionalUploadsDirs = [legacyRootUploadsDir].filter((dir) => path.resolve(dir) !== path.resolve(uploadsDir));

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.memoryStorage();

export const imageUpload = multer({ storage });

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

function safeExt(fileName: string): string {
  const ext = path.extname(fileName || "").toLowerCase();
  if (!ext || ext.length > 10) return ".jpg";
  return ext;
}

function contentTypeFromExt(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic") return "image/heic";
  if (ext === ".jpeg" || ext === ".jpg") return "image/jpeg";
  return "application/octet-stream";
}

export async function persistUploadedImage(file: Express.Multer.File, folder: string): Promise<string> {
  const ext = safeExt(file.originalname);
  const cleanFolder = folder.replace(/[^a-zA-Z0-9-_]/g, "") || "misc";
  const objectName = `${cleanFolder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  const supabase = getSupabaseClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "wms-images";

  if (supabase) {
    const { error } = await supabase.storage.from(bucket).upload(objectName, file.buffer, {
      contentType: file.mimetype || contentTypeFromExt(ext),
      upsert: false
    });
    if (error) {
      throw new Error(`Falha ao enviar imagem para Supabase Storage: ${error.message}`);
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectName);
    return data.publicUrl;
  }

  const localDir = path.resolve(uploadsDir, cleanFolder);
  fs.mkdirSync(localDir, { recursive: true });
  const localName = `${randomUUID()}${ext}`;
  fs.writeFileSync(path.resolve(localDir, localName), file.buffer);
  return `/uploads/${cleanFolder}/${localName}`;
}
