import { it,expect,vi,afterEach } from 'vitest';
import { validateImportTarget } from '../src/stock/importTarget.js';
afterEach(()=>vi.unstubAllEnvs());
it('producao exige WMS em consulta, hash do relatorio e backup',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('STOCK_ENABLED','true');vi.stubEnv('STOCK_READ_ONLY','true');const url=new URL('postgresql://test:test@wms_postgres/wms_expedicao');
  await expect(validateImportTarget(url,'hash')).rejects.toThrow('hash');
  await expect(validateImportTarget(url,'hash','hash')).rejects.toThrow('backup-file');
  vi.stubEnv('STOCK_READ_ONLY','false');await expect(validateImportTarget(url,'hash','hash','/tmp/backup.dump')).rejects.toThrow('em consulta');
  vi.stubEnv('STOCK_READ_ONLY','true');await expect(validateImportTarget(new URL('postgresql://test:test@wms_postgres/crm'),'hash','hash','/tmp/backup.dump')).rejects.toThrow('WMS');
});
