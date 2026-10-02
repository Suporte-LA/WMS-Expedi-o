# Estoque endereçado — WMS

Reconstrução do módulo de estoque do WMS Expedição. **Disponibilização online em consulta, aguardando a planilha atualizada.** Usa React/Vite, Express, PostgreSQL e o login existente. A stack sugerida no prompt foi adaptada para evitar um segundo sistema de autenticação. Transações `pg` substituem Prisma; o schema SQL versionado está em `backend/stock-sql`. As tabelas legadas `stock_*` não são alteradas nem importadas automaticamente.

## Executar com Docker

Na raiz, com Docker Desktop em execução, defina três variáveis no PowerShell. Escolha senhas locais próprias; a senha do banco deve estar codificada para uso em URL se tiver caracteres especiais.

```powershell
$env:WMS_STOCK_DB_PASSWORD = 'substitua-por-senha-local'
$env:WMS_STOCK_JWT_SECRET = 'substitua-por-segredo-aleatorio-longo'
$env:WMS_SEED_PASSWORD = 'substitua-por-senha-com-12-caracteres'
docker compose -f compose.stock.yml up --build -d
```

Abra **http://localhost:5180/estoque**. Login: `admin@wms.local`, senha definida em `WMS_SEED_PASSWORD`. O seed inclui produto de demonstração, EAN unidade `7891234567895`, EAN caixa `17891234567892` (12 unidades) e 28 posições. Executar novamente não troca a senha nem duplica cadastros.

O banco `wms_stock_dev` e o volume `stock_development_data` são exclusivos deste Compose. A API e o banco não expõem portas ao host; a interface escuta apenas em `127.0.0.1:5180`. `docker compose -f compose.stock.yml down` para os serviços preservando os dados. Não use este perfil em hospedagem pública.

## Executar sem Docker para a aplicação

Requer Node 22 e PostgreSQL local. Na raiz: `npm ci`. Configure no terminal `DATABASE_URL` para um banco local cujo nome termine em `_stock_dev` ou `_stock_test`, `JWT_SECRET`, `NODE_ENV=development` e `WMS_SEED_PASSWORD`. Não use as credenciais de produção.

```powershell
npm run stock:setup -w backend -- --seed
npm run dev:backend
# Em outro terminal:
npm run dev:frontend
```

Abra `/estoque` e selecione Estoque no menu, quando necessário. Para testar a abertura offline/PWA, use o build específico:

```powershell
npm run build:stock -w frontend
npm run preview -w frontend -- --mode stock --outDir dist-stock --host 127.0.0.1 --port 5181
```

A API local deve estar em `localhost:4000`. O build normal inclui Estoque, e o servidor controla a disponibilidade com `STOCK_ENABLED=true` (desativado por padrão). `npm run dev:backend` habilita o módulo local. O build `stock` possui apenas Estoque no seletor de módulos.

## Operação

- Ocupação e busca: filtros por galpão, rua, lado, status, produto e validade; posições ordenadas por FEFO.
- Entrada: EAN por câmera ou leitor com Enter, conversão de caixas, endereço por etiqueta/seletor, validade e aviso FEFO.
- Saída: saldo verificado no servidor. Transferência parcial: duas pernas indivisíveis, com a mesma quantidade e validade.
- Inventário e estorno: somente supervisor/admin, motivo obrigatório, sem alterar movimentos anteriores. Estorno de transferência desfaz as duas pernas e falha integralmente se o saldo tiver sido consumido.
- Produtos: cadastro, edição, inativação e CSV/XLSX. EANs de unidade/caixa compartilham uma única restrição de unicidade.
- Endereços: cadastro, gerador, importação, bloqueio, lado configurável por rua e etiquetas CODE128. Endereços com histórico não podem ser excluídos ou renumerados.
- Dashboard: ocupação, percentual vazio, validades 30/60/90 dias e conferência do saldo contra o ledger sob demanda.
- Histórico: filtros e exportação CSV/XLSX até 10.000 linhas por consulta. Reduza o período para exportações maiores.

Datas de validade são datas sem horário; histórico exibido em `America/Sao_Paulo`. Status, lado e local são derivados. Auditoria inclui usuário autenticado, IP/dispositivo e antes/depois. O Compose confia apenas no seu proxy Nginx.

## Offline

Entre com conexão e clique **Preparar uso offline**. Em builds de produção, aguarde a instalação do service worker; o aplicativo pode ser reaberto em `/estoque` sem rede. Instalação/câmera exigem localhost ou HTTPS em dispositivos móveis. Cadastros de gestão exigem conexão.

Movimentos ficam em IndexedDB por usuário. O saldo exibido offline é uma fotografia, não uma reserva. Ao reconectar, os envios seguem em ordem; o primeiro conflito interrompe os seguintes. Na Fila offline, confira a mensagem e corrija quantidade/destino, tente novamente ou descarte o envio local. Cada operação tem UUID idempotente; perder a resposta não duplica o lançamento. Faça login com o mesmo usuário para sincronizar. Limpar os dados do navegador apaga pendências locais. APIs autenticadas não são armazenadas pelo service worker.

## Migração Google Sheets (CSV exportado)

O script **não acessa nem altera a planilha original**. Exporte UTF-8 para uma pasta local ignorada pelo Git, por exemplo `stock-migration-data`. Arquivos obrigatórios: `Cadastro.csv`, `Ocupacao.csv`, `Estoque.csv`, `Lancamento.csv` (nomes de arquivo sem acento). Cabeçalhos aceitam espaços/acentos, delimitador `;` ou `,`. Não converta EANs em números ou notação científica no Excel.

Colunas principais:

| Arquivo | Colunas |
| --- | --- |
| Cadastro | `codigo,descricao,ean_unidade,ean_caixa,fornecedor,qtd_unitario,qtd_na_caixa,peso,endereco_padrao` |
| Ocupacao | `endereco,status,bloqueado,motivo_bloqueio` |
| Estoque | `codigo,endereco,quantidade,validade,nome,data,tipo,endereco_origem,transferencia_id,lote,observacao,ean` |
| Lancamento | `codigo,endereco,quantidade,validade,nome,data,tipo,endereco_destino,transferencia_id,lote,observacao,ean` |

Campos opcionais podem ficar vazios. Datas: `dd/mm/aaaa` ou `aaaa-mm-dd`; timestamps ISO com fuso também são aceitos. `codigo_produto` é alias de `codigo`; se ausente, um EAN cadastrado resolve o produto. Quantidades históricas são **unidades**, não caixas. Código de endereço deve ter 9 dígitos. Colunas de dashboard e `local` são ignoradas: o local é reconstruído das coordenadas (colunas 1–7 A por padrão; configure exceções por rua após importar).

Transferências precisam de uma saída identificável no Lançamento com o mesmo `transferencia_id` (ou `endereco_destino` explícito), produto, validade, origem e quantidade. Pares ambíguos/incompletos são bloqueados; o script não fabrica a saída que o bot antigo deixou de executar.

Primeiro, apenas conferir (não exige conexão com banco):

```powershell
npm run stock:migrate -w backend -- --dir ../stock-migration-data
```

Revise `conferencia-wms.json`: erros por linha, EANs duplicados/inválidos, negativos finais e históricos, múltiplos produtos/validades por posição, divergências de status e transferências desbalanceadas. Corrija os CSVs e repita. EAN inválido é aviso, salvo se a validação estrita estiver ativa; EAN duplicado sempre bloqueia.

Para aplicar, use **outro banco de desenvolvimento vazio**, configure as variáveis locais e crie somente o administrador, sem os produtos/endereços de demonstração:

```powershell
npm run stock:setup -w backend -- --seed-user
npm run stock:migrate -w backend -- --dir ../stock-migration-data --apply --admin-email admin@wms.local
```

Não é permitido misturar a migração com cadastros já existentes. O histórico mantém datas e autoria; nomes novos geram usuários **inativos**, sem credencial utilizável. Nomes coincidentes com mais de um usuário bloqueiam a aplicação. A importação inteira usa uma transação e auditoria, e reexecutar não duplica dados.

Negativos não são corrigidos por padrão. Após revisão humana, `--aprovar-negativos HASH` autoriza movimentos positivos `AJUSTE_INVENTARIO` para zerar exatamente os negativos do relatório com aquele hash. CSV alterado invalida a aprovação. Os movimentos históricos permanecem intactos; não há saldo negativo na tabela operacional.

Nenhuma planilha real foi fornecida nesta entrega. A migração foi validada com dados sintéticos; a conferência dos CSVs reais precede seu uso operacional.

## Verificação

```powershell
npm run check
npm run lint:stock -w frontend
# Banco de teste descartável com nome terminado em _stock_test:
$env:STOCK_TEST_DATABASE_URL = 'postgresql://usuario:senha@127.0.0.1:5432/wms_stock_test'
npm run test:stock -w backend
# API dev + preview stock já em execução, com WMS_SEED_PASSWORD definida:
npx playwright install chromium
npm run test:stock:e2e -w backend
```

Vitest usa schemas temporários no banco indicado. Playwright usa `STOCK_E2E_URL` (padrão `http://127.0.0.1:5181`), cria cadastros e movimentos sintéticos e só aceita localhost; use exclusivamente o banco de teste. Os testes verificam concorrência real no PostgreSQL, rollback, idempotência, migração, permissões, importações e fluxos de navegador/offline. Dados de teste não são enviados à produção.

## Online e carga inicial

URL: https://wms.bemvindoalourencoalimentos.com/estoque. Usa os mesmos logins e permissões do WMS. Na VPS, `STOCK_ENABLED=true` e `STOCK_READ_ONLY=true`: consultas liberadas; cadastros, importações e movimentos via API retornam 423. Administradores liberam o acesso dos demais usuários pelas configurações existentes.

O deploy executa somente migrations do schema `wms_*`, com lock e transação. Não cria demonstrações, não modifica saldos legados e não importa planilhas automaticamente. Mantenha o modo consulta até conferir a carga inicial.

`deploy/backup-wms.sh` gera dump custom do banco `wms_expedicao` e valida seu catálogo. Antes de importar a planilha real: execute o dry-run, confira o relatório, gere backup recente e execute o script de migração com `--apply --admin-email EMAIL_EXISTENTE --confirmar-producao HASH_DO_RELATORIO --backup-file /caminho/absoluto/backup.dump`. O backup deve estar acessível ao processo importador. O destino de produção exige `NODE_ENV=production`, host `wms_postgres`, banco `wms_expedicao` e ambas as flags habilitadas. A carga exige tabelas de estoque vazias; não altera os dados de expedição. Somente após a conferência final, altere `STOCK_READ_ONLY=false` e recrie apenas o backend.
