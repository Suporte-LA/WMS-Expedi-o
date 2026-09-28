# KPI Operacional (MVP Fase 1)

Sistema para migrar sua operacao do AppSheet para stack propria com:
- Login + perfis (`admin`, `supervisor`, `operator`)
- Importacao de KPI via CSV/XLSX com validacao e UPSERT
- Dashboard com cards, tendencia diaria e ranking
- Historico de imports
- Gestao de usuarios (admin)
- Descer pedidos com foto e usuario/cor automaticos
- Conferencia de erros com lookup por pedido
- Relatorio de erros e ranking por conferente/usuario

## Stack
- Backend: Node.js + Express + TypeScript + PostgreSQL
- Frontend: React + Vite + Tailwind

## Estrutura
- `backend`: API e banco
- `frontend`: interface web

## 1) Preparar banco
Crie um PostgreSQL e configure a URL no arquivo `backend/.env`:

```env
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kpi_app
JWT_SECRET=troque-esse-segredo
JWT_EXPIRES_IN=12h
```

Pode copiar de `backend/.env.example`.

## 2) Instalar dependencias
No diretorio raiz:

```bash
npm install
```

## 3) Rodar migration e criar admin inicial

```bash
npm run db:migrate -w backend
npm run db:seed-admin -w backend
```

Credenciais padrao do seed:
- email: `admin@local.com`
- senha: `admin123`

Pode alterar via variaveis:
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## 4) Subir ambiente

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Endpoints principais
- `POST /auth/login`
- `GET /auth/me`
- `POST /imports/kpi`
- `GET /imports`
- `GET /imports/:id`
- `GET /kpi?from&to&user`
- `GET /kpi/ranking?from&to&metric=orders|boxes|weight`
- `POST /descents` (multipart com `image`)
- `GET /descents`
- `GET /descents/dashboard?from&to`
- `GET /descents/lookup/:orderNumber`
- `POST /errors` (multipart com `image`)
- `GET /errors`
- `GET /errors/dashboard?from&to`

## Regras da importacao KPI
- Colunas esperadas (com aliases): `Usuario`, `Data`, `Pedidos`, `Volume/Caixas`, `Peso/KG`
- Data: aceita `dd/mm/aaaa`, ISO e serial de data Excel
- Chave unica: `(user_name, work_date)`
- Modo: UPSERT

## Proximo passo (Fase 2)
Integrar com WMS/TXT/API para preencher volume/peso/doca automaticamente por pedido.


## Separa??o dos m?dulos (28/09/2026)

TI e Estoque TI foram extra?dos para `../Sistema-TI`, fora deste reposit?rio, com manifesto SHA-256. A pasta cont?m o c?digo para iniciar um projeto independente; n?o ? uma aplica??o publicada. As telas, rotas da API e scripts de TI foram removidos do WMS. Migra??es hist?ricas permanecem para compatibilidade dos bancos existentes; nenhum dado foi apagado.

O estoque geral permanece em desenvolvimento: `npm run dev` habilita a tela pelo Vite e a API pelo inicializador `backend/src/dev.ts`. Em produ??o (ou sem NODE_ENV), `/stock` n?o ? registrado; o build de produ??o n?o inclui a tela StockPage. N?o iniciar servidores online com NODE_ENV=development.

Valida??o: `npm run build` e `npm run test:modules -w backend`. As verifica??es de API n?o acessam o banco.

Estas altera??es locais precisam de uma nova publica??o para entrar em vigor no sistema online.


## Melhorias da auditoria adaptadas ao WMS (28/09/2026)

- API consulta o usuario atual a cada requisicao autenticada; desativacao e mudanca de perfil passam a valer mesmo com JWT antigo. Falhas de consulta de permissoes retornam 503.
- Supervisores nao podem criar perfis administrativos, promover usuarios ou alterar contas administrativas. O proprio usuario nao pode se desativar/rebaixar pela API.
- Login limitado a 20 tentativas com falha por IP a cada 15 minutos, por processo. Para multiplas replicas, substituir o armazenamento local por um compartilhado. Configurar TRUST_PROXY_HOPS somente com a porta da API protegida contra acesso direto.
- CORS usa CORS_ORIGINS; o frontend padrao continua usando /api na mesma origem. URLs externas de frontend devem ser adicionadas explicitamente.
- Uploads: imagens ate 10 MiB, planilhas ate 20 MiB; formato das imagens identificado pelo conteudo. HTML/SVG nao aceitos como imagens. Respostas de erro nao expoem SQL ou detalhes internos.
- Telas carregadas sob demanda, com tratamento de erro e estado de carregamento acessivel. Dashboard com React Query, cache de 30 segundos, cancelamento de consultas antigas e invalidacao apos escritas e troca de sessao. A paginacao nao refaz os rankings dentro da janela de cache.
- Datas do dashboard preservam o dia operacional, sem recuar um dia pelo fuso horario. CSV protege celulas contra formulas e escapa aspas/separadores.
- Transacoes das permissoes usam uma conexao dedicada, com rollback e liberacao garantidos.
- Dependencias atualizadas; SheetJS vem da distribuicao oficial 0.20.3 e csv-parse da serie 7. O npm audit ainda aponta um alerta baixo no esbuild transitivo de desenvolvimento, sem alertas altos/criticos na verificacao realizada.
- Docker usa Node 22 e npm ci com o lockfile raiz dos workspaces; credenciais e uploads locais ficam fora do contexto de build. CI executa lint do conjunto novo/refatorado, TypeScript, build, testes e auditoria de dependencias altas/criticas.

Verificacao local: `npm run check`. O lint integral legado continua separado (`npm run lint -w frontend`); nao se declara o repositorio inteiro livre de problemas de lint. Testes usam banco simulado e arquivos sinteticos, sem alterar dados reais. A verificacao visual usa respostas locais simuladas. Nao houve publicacao nem migracao de banco nesta alteracao.

Referencias tecnicas: [React Query](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults), [SheetJS oficial](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), [Express e proxies](https://expressjs.com/en/guide/behind-proxies/).
