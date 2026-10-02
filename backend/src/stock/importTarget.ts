import fs from 'node:fs/promises';
import path from 'node:path';

export async function validateImportTarget(url: URL, fingerprint: string, confirmation?: string, backupFile?: string) {
  const local=process.env.NODE_ENV==='development' && ['localhost','127.0.0.1','stock_db'].includes(url.hostname) && /stock_(dev|test)$/.test(url.pathname);
  if(local)return;
  if(process.env.NODE_ENV!=='production'||url.hostname!=='wms_postgres'||url.pathname!=='/wms_expedicao'||process.env.STOCK_ENABLED!=='true'||process.env.STOCK_READ_ONLY!=='true')throw new Error('Importacao permitida apenas no banco local de teste ou no WMS da VPS, habilitado e em consulta.');
  if(confirmation!==fingerprint)throw new Error('Revise o dry-run e informe --confirmar-producao com o hash do relatorio aprovado.');
  if(!backupFile||!path.isAbsolute(backupFile))throw new Error('Informe --backup-file com o caminho absoluto do dump WMS recente e validado.');
  const stat=await fs.stat(backupFile);
  if(!stat.isFile()||stat.size<100||Date.now()-stat.mtimeMs>24*60*60*1000)throw new Error('Backup invalido ou anterior a 24 horas. Gere e valide um novo dump antes da carga.');
  const file=await fs.open(backupFile,'r');try{const header=Buffer.alloc(5);await file.read(header,0,5,0);if(header.toString()!=='PGDMP')throw new Error('Backup deve ser pg_dump em formato custom (-Fc).');}finally{await file.close();}
}
