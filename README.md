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
