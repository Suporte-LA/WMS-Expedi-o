import { Pool } from "pg";
import { config } from "./config.js";

function withoutSslModeParam(connectionString: string) {
  return connectionString
    .replace(/([?&])sslmode=[^&]*&?/i, "$1")
    .replace(/[?&]$/g, "");
}

export const pool = new Pool({
  connectionString: withoutSslModeParam(config.databaseUrl),
  ssl: {
    rejectUnauthorized: false
  }
});
