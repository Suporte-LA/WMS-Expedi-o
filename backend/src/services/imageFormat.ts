import { HttpError } from "./httpError.js";

export function detectImageFormat(buffer: Buffer): { ext: string; contentType: string } {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { ext: ".jpg", contentType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { ext: ".png", contentType: "image/png" };
  }
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { ext: ".gif", contentType: "image/gif" };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { ext: ".webp", contentType: "image/webp" };
  }
  if (buffer.toString("ascii", 4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx"].includes(buffer.toString("ascii", 8, 12))) {
    return { ext: ".heic", contentType: "image/heic" };
  }
  throw new HttpError(415, "Envie uma imagem JPEG, PNG, GIF, WebP ou HEIC valida.");
}
