import { it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { migrateStock } from '../src/stock/migrations.js';
const url=process.env.STOCK_TEST_DATABASE_URL;
if(!url||!/stock_test$/.test(new URL(url).pathname))throw new Error('Use banco descartavel *_stock_test.');
it('schema de producao e idempotente, concorrente e nao cria dados demonstrativos',async()=>{
  const schema='setup_'+randomUUID().replaceAll('-','');const pool=new Pool({connectionString:url});const scoped=new Pool({connectionString:url,options:`-c search_path=${schema},public`});
  try{
    await pool.query(`CREATE SCHEMA ${schema}`);await scoped.query('CREATE TABLE users(id uuid PRIMARY KEY)');await scoped.query('INSERT INTO users VALUES($1)',[randomUUID()]);
    await Promise.all([migrateStock(scoped),migrateStock(scoped)]);
    expect((await scoped.query('SELECT count(*)::int AS n FROM wms_schema_migrations')).rows[0].n).toBe(1);
    expect((await scoped.query('SELECT count(*)::int AS n FROM wms_products')).rows[0].n).toBe(0);
    expect((await scoped.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(1);
  }finally{await scoped.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();}
});
