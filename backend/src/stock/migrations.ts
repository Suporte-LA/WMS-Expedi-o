import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { transaction } from './service.js';

// Schema only. Uses existing WMS users; never seeds or copies legacy balances.
export async function migrateStock(pool: Pool) {
  await transaction(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(73142026)');
    await c.query('CREATE TABLE IF NOT EXISTS wms_schema_migrations(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now())');
    const folder=fileURLToPath(new URL('../../stock-sql/',import.meta.url));
    for(const name of (await fs.readdir(folder)).filter(f=>f.endsWith('.sql')).sort()){
      if((await c.query('SELECT 1 FROM wms_schema_migrations WHERE filename=$1',[name])).rowCount)continue;
      await c.query(await fs.readFile(new URL(name,new URL('../../stock-sql/',import.meta.url)),'utf8'));
      await c.query('INSERT INTO wms_schema_migrations(filename) VALUES($1)',[name]);
      console.log(`Estoque: schema aplicado ${name}`);
    }
  });
}
