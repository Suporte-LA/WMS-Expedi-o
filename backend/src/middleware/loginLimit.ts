import type { RequestHandler } from "express";

// Local to this API process. A multi-replica deployment needs a shared store.
export function createLoginLimiter(limit = 20, windowMs = 15 * 60_000): RequestHandler {
  const attempts = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) {
      if (value.expires <= now) attempts.delete(key);
    }
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let entry = attempts.get(key);
    if (!entry) {
      // Bound memory without evicting active limits under attack.
      if (attempts.size >= 10_000) return res.status(429).json({ message: "Tente novamente mais tarde." });
      entry = { count: 0, expires: now + windowMs };
      attempts.set(key, entry);
    }
    if (entry.count >= limit) {
      res.setHeader("Retry-After", Math.ceil((entry.expires - now) / 1000));
      return res.status(429).json({ message: "Muitas tentativas de login. Aguarde antes de tentar novamente." });
    }
    entry.count++;
    res.once("finish", () => {
      if (res.statusCode < 400) entry.count = Math.max(0, entry.count - 1);
    });
    next();
  };
}
