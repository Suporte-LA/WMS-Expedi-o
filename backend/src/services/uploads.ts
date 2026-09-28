import fs from "fs";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { detectImageFormat } from "./imageFormat.js";

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

export const imageUpload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 30, fieldSize: 64 * 1024 } });

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

export async function persistUploadedImage(file: Express.Multer.File, folder: string): Promise<string> {
  const { ext, contentType } = detectImageFormat(file.buffer);
  const cleanFolder = folder.replace(/[^a-zA-Z0-9-_]/g, "") || "misc";
  const objectName = `${cleanFolder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  const supabase = getSupabaseClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "wms-images";

  if (supabase) {
    const { error } = await supabase.storage.from(bucket).upload(objectName, file.buffer, {
      contentType,
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
