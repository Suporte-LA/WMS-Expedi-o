import { Pool } from "pg";
import { config } from "./config.js";

function withoutSslModeParam(connectionString: string) {
  return connectionString
    .replace(/([?&])sslmode=[^&]*&?/i, "$1")
    .replace(/[?&]$/g, "");
}

const connectionString = withoutSslModeParam(config.databaseUrl);
const isLocalDb =
  connectionString.includes("localhost") ||
  connectionString.includes("127.0.0.1") ||
  connectionString.includes("wms_postgres");

export const pool = new Pool({
  connectionString,
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } }),
});
