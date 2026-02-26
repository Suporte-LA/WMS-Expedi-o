import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h"
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!config.jwtSecret) {
  throw new Error("JWT_SECRET is required");
}
