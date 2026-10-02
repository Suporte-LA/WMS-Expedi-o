import { pool } from '../../src/db.js';
import { stockEnabled } from '../../src/services/availableWorkspaces.js';
import { migrateStock } from '../../src/stock/migrations.js';
try { if(stockEnabled)await migrateStock(pool);else console.log('Estoque desativado: schema nao aplicado.'); }
finally { await pool.end(); }
