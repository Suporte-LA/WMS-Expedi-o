import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const name = process.env.ADMIN_NAME || "Administrador";
const email = (process.env.ADMIN_EMAIL || "admin@local.com").toLowerCase();
const password = process.env.ADMIN_PASSWORD || "admin123";

async function run() {
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rowCount) {
    console.log(`Admin já existe: ${email}`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, 'admin')
    `,
    [name, email, passwordHash]
  );
  console.log(`Admin criado: ${email}`);
  await pool.end();
}

run().catch(async (error) => {
  console.error("Erro ao criar admin:", error);
  await pool.end();
  process.exit(1);
});
