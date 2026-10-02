import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db.js";
import { authRequired, type AuthenticatedRequest } from "../middleware/auth.js";
import { HttpError } from "../services/httpError.js";
import { csvCell } from "../services/csv.js";
import {
  StockService,
  audit,
  requireManager,
  transaction,
  type Actor,
} from "../stock/service.js";
import {
  addressSchema,
  decomporEndereco,
  normalizarEan,
} from "../stock/rules.js";
import { productFromRow, readRows } from "../stock/imports.js";

export const stockRouter = Router();
const service = new StockService(pool);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 },
});
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
const actor = (req: AuthenticatedRequest): Actor => ({
  id: req.user!.id,
  role: req.user!.role,
  ip: req.ip,
  device: req.headers["user-agent"],
});
const uuid = (value: unknown) => z.string().uuid().parse(value);
const manager = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  requireManager(actor(req));
  next();
};
stockRouter.use(authRequired, async (req: AuthenticatedRequest, res, next) => {
  if (!["admin", "supervisor", "operator"].includes(req.user!.role))
    return res.status(403).json({ message: "Perfil sem acesso ao estoque." });
  if (req.user!.role === "admin" || req.user!.workspace === "estoque")
    return next();
  const enabled = await pool.query(
    "SELECT is_enabled FROM user_workspace_permissions WHERE user_id=$1 AND workspace='estoque'",
    [req.user!.id],
  );
  if (!enabled.rows[0]?.is_enabled)
    return res
      .status(403)
      .json({ message: "Acesso ao estoque nao autorizado." });
  next();
});

stockRouter.get("/bootstrap", async (req: AuthenticatedRequest, res) => {
  const [settings, streets, operators] = await Promise.all([
    pool.query("SELECT * FROM wms_settings WHERE id=true"),
    pool.query("SELECT * FROM wms_streets ORDER BY galpao,rua"),
    pool.query(
      "SELECT id,name FROM users WHERE (is_active=true AND role IN ('admin','supervisor','operator')) OR EXISTS(SELECT 1 FROM wms_movements WHERE operador_id=users.id) ORDER BY name",
    ),
  ]);
  res.json({
    settings: settings.rows[0],
    streets: streets.rows,
    operators: operators.rows,
    user: req.user,
  });
});
stockRouter.put("/settings", manager, async (req, res) => {
  const value = z
    .object({ allow_same_expiry: z.boolean(), strict_ean: z.boolean() })
    .parse(req.body);
  await transaction(pool, async (c) => {
    const before = (
      await c.query("SELECT * FROM wms_settings WHERE id=true FOR UPDATE")
    ).rows[0];
    await c.query(
      "UPDATE wms_settings SET allow_same_expiry=$1,strict_ean=$2 WHERE id=true",
      [value.allow_same_expiry, value.strict_ean],
    );
    await audit(c, actor(req), "CONFIGURACAO", "true", before, value);
  });
  res.json(value);
});
stockRouter.get("/lookup/:ean", async (req, res) =>
  res.json(await service.resolverProduto(String(req.params.ean))),
);
stockRouter.get("/products", async (req, res) => {
  const { page, pageSize } = paging.parse(req.query);
  const q = String(req.query.q || "").slice(0, 200);
  const result = await pool.query(
    `SELECT p.*,count(*) OVER()::int AS total FROM wms_products p
    WHERE ($1='' OR codigo ILIKE '%'||$1||'%' OR descricao ILIKE '%'||$1||'%' OR ean_unidade=$2 OR ean_caixa=$2)
    ORDER BY descricao,id LIMIT $3 OFFSET $4`,
    [q, normalizarEan(q), pageSize, (page - 1) * pageSize],
  );
  res.json({
    items: result.rows,
    total: result.rows[0]?.total || 0,
    page,
    pageSize,
  });
});
stockRouter.post("/products", manager, async (req, res) =>
  res.status(201).json(await service.saveProduct(req.body, actor(req))),
);
stockRouter.put("/products/:id", manager, async (req, res) =>
  res.json(
    await service.saveProduct(req.body, actor(req), uuid(req.params.id)),
  ),
);
stockRouter.delete("/products/:id", manager, async (req, res) => {
  await transaction(pool, async (c) => {
    const id = uuid(req.params.id);
    const before = (
      await c.query("SELECT * FROM wms_products WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!before) throw new HttpError(404, "Produto nao encontrado.");
    await c.query(
      "UPDATE wms_products SET ativo=false,updated_at=now() WHERE id=$1",
      [id],
    );
    await audit(c, actor(req), "PRODUTO_INATIVADO", id, before, {
      ...before,
      ativo: false,
    });
  });
  res.json({ ok: true });
});
stockRouter.post(
  "/products/import",
  manager,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, "Selecione o arquivo.");
    const rows = readRows(req.file.buffer, req.file.originalname);
    const errors: { linha: number; erro: string }[] = [];
    const warnings: { linha: number; avisos: string[] }[] = [];
    let inserted = 0;
    for (const [index, row] of rows.entries()) {
      try {
        const input = productFromRow(row);
        const preferred = String(
          row.endereco_padrao ?? row.endereco_padrao_codigo ?? "",
        ).trim();
        if (preferred) {
          const address = (
            await pool.query("SELECT id FROM wms_addresses WHERE codigo=$1", [
              preferred,
            ])
          ).rows[0];
          if (!address)
            throw new HttpError(422, "Endereco padrao nao cadastrado.");
          input.endereco_padrao_id = address.id;
        }
        const saved = await service.saveProduct(input, actor(req));
        inserted++;
        if (saved.avisos.length)
          warnings.push({ linha: index + 2, avisos: saved.avisos });
      } catch (error) {
        errors.push({ linha: index + 2, erro: publicError(error) });
      }
    }
    res.json({ inserted, errors, warnings });
  },
);

function occupancyFilter(query: Request["query"]) {
  const schema = z.object({
    q: z.string().max(200).optional(),
    galpao: z.coerce.number().int().optional(),
    rua: z.coerce.number().int().optional(),
    lado: z.enum(["A", "B"]).optional(),
    status: z.enum(["Vazio", "Ocupado", "Bloqueado"]).optional(),
    produto_id: z.string().uuid().optional(),
    validade: z.string().date().optional(),
  });
  const values: unknown[] = [];
  const where: string[] = [];
  const filter = schema.parse(query);
  if (query.com_saldo === "1") where.push("quantidade>0");
  if (query.validade_de) {
    values.push(z.string().date().parse(query.validade_de));
    where.push(`validade>$${values.length}`);
  }
  for (const key of [
    "galpao",
    "rua",
    "lado",
    "status",
    "produto_id",
    "validade",
  ] as const)
    if (filter[key] !== undefined) {
      values.push(filter[key]);
      where.push(`${key}${key === "validade" ? "<=" : "="}$${values.length}`);
    }
  if (filter.q) {
    values.push(filter.q);
    const i = values.length;
    values.push(normalizarEan(filter.q));
    where.push(
      `(codigo=$${i} OR produto_codigo ILIKE '%'||$${i}||'%' OR descricao ILIKE '%'||$${i}||'%' OR ean_unidade=$${i + 1} OR ean_caixa=$${i + 1})`,
    );
  }
  return { values, where: where.length ? "WHERE " + where.join(" AND ") : "" };
}
stockRouter.get("/occupancy", async (req, res) => {
  const { page, pageSize } = paging.parse(req.query);
  const { values, where } = occupancyFilter(req.query);
  const result = await pool.query(
    `SELECT *,validade::text,count(*) OVER()::int AS total FROM wms_occupancy ${where} ORDER BY wms_occupancy.validade NULLS LAST,codigo LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  res.json({
    items: result.rows,
    total: result.rows[0]?.total || 0,
    page,
    pageSize,
  });
});
stockRouter.post("/operations", async (req, res) =>
  res.status(201).json(await service.execute(req.body, actor(req))),
);
stockRouter.get("/movements", async (req, res) => {
  const { page, pageSize } = paging.parse(req.query);
  const filter = z
    .object({
      from: z.string().date().optional(),
      to: z.string().date().optional(),
      tipo: z
        .enum([
          "ENTRADA",
          "SAIDA",
          "TRANSFERENCIA_SAIDA",
          "TRANSFERENCIA_ENTRADA",
          "AJUSTE_INVENTARIO",
          "ESTORNO",
        ])
        .optional(),
      produto_id: z.string().uuid().optional(),
      endereco_id: z.string().uuid().optional(),
      operador_id: z.string().uuid().optional(),
      export: z.enum(["csv", "xlsx"]).optional(),
    })
    .parse(req.query);
  if (filter.from && filter.to && filter.from > filter.to)
    throw new HttpError(422, "Periodo invalido.");
  const values: unknown[] = [];
  const where: string[] = [];
  const productQuery = z.string().max(200).optional().parse(req.query.produto);
  const addressQuery = z
    .string()
    .regex(/^\d{9}$/)
    .optional()
    .parse(req.query.endereco);
  if (productQuery) {
    values.push(productQuery);
    const i = values.length;
    values.push(normalizarEan(productQuery));
    where.push(
      `(p.codigo ILIKE '%'||$${i}||'%' OR p.descricao ILIKE '%'||$${i}||'%' OR p.ean_unidade=$${i + 1} OR p.ean_caixa=$${i + 1})`,
    );
  }
  if (addressQuery) {
    values.push(addressQuery);
    where.push(`a.codigo=$${values.length}`);
  }
  for (const key of [
    "tipo",
    "produto_id",
    "endereco_id",
    "operador_id",
  ] as const)
    if (filter[key]) {
      values.push(filter[key]);
      where.push(`m.${key}=$${values.length}`);
    }
  if (filter.from) {
    values.push(filter.from);
    where.push(
      `m.created_at>=($${values.length}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
    );
  }
  if (filter.to) {
    values.push(filter.to);
    where.push(
      `m.created_at<(($${values.length}::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
    );
  }
  const result = await pool.query(
    `SELECT m.*,m.validade::text,p.codigo AS produto_codigo,p.descricao,a.codigo AS endereco_codigo,u.name AS operador,
    EXISTS(SELECT 1 FROM wms_movements r WHERE r.estorno_de_id=m.id) AS estornado,count(*) OVER()::int AS total
    FROM wms_movements m JOIN wms_products p ON p.id=m.produto_id JOIN wms_addresses a ON a.id=m.endereco_id JOIN users u ON u.id=m.operador_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY m.created_at DESC,m.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [
      ...values,
      filter.export ? 10001 : pageSize,
      filter.export ? 0 : (page - 1) * pageSize,
    ],
  );
  if (filter.export) {
    if (result.rows.length > 10000)
      throw new HttpError(
        422,
        "Filtre o periodo para exportar ate 10.000 movimentos.",
      );
    const rows = result.rows.map((m) => ({
      Data: new Date(m.created_at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
      Tipo: m.tipo,
      Produto: m.produto_codigo,
      Descricao: m.descricao,
      Endereco: m.endereco_codigo,
      Validade: m.validade.split("-").reverse().join("/"),
      Quantidade: m.quantidade,
      Sinal: m.sinal,
      Operador: m.operador,
      Observacao: m.observacao || "",
    }));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=movimentacoes.${filter.export}`,
    );
    if (filter.export === "csv")
      return res.type("text/csv").send(
        "\ufeff" +
          [
            Object.keys(
              rows[0] || {
                Data: "",
                Tipo: "",
                Produto: "",
                Descricao: "",
                Endereco: "",
                Validade: "",
                Quantidade: 0,
                Sinal: 0,
                Operador: "",
                Observacao: "",
              },
            )
              .map(csvCell)
              .join(";"),
            ...rows.map((row) => Object.values(row).map(csvCell).join(";")),
          ].join("\r\n"),
      );
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      "Movimentacoes",
    );
    return res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }
  res.json({
    items: result.rows,
    total: result.rows[0]?.total || 0,
    page,
    pageSize,
  });
});

stockRouter.get("/addresses/:id", async (req, res) => {
  const row = (
    await pool.query("SELECT *,validade::text FROM wms_occupancy WHERE id=$1", [
      uuid(req.params.id),
    ])
  ).rows[0];
  if (!row) throw new HttpError(404, "Endereco nao encontrado.");
  res.json(row);
});
stockRouter.post("/addresses", manager, async (req, res) => {
  const a = addressSchema.parse(req.body);
  const result = await transaction(pool, async (c) => {
    await c.query(
      "INSERT INTO wms_streets(galpao,rua) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [a.galpao, a.rua],
    );
    const row = (
      await c.query(
        "INSERT INTO wms_addresses(galpao,rua,coluna,nivel,posicao,bloqueado,motivo_bloqueio) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          a.galpao,
          a.rua,
          a.coluna,
          a.nivel,
          a.posicao,
          a.bloqueado,
          a.motivo_bloqueio,
        ],
      )
    ).rows[0];
    await audit(c, actor(req), "ENDERECO_CRIADO", row.id, null, row);
    return row;
  });
  res.status(201).json(result);
});
stockRouter.put("/addresses/:id", manager, async (req, res) => {
  const a = addressSchema.parse(req.body);
  const id = uuid(req.params.id);
  const row = await transaction(pool, async (c) => {
    const before = (
      await c.query("SELECT * FROM wms_addresses WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!before) throw new HttpError(404, "Endereco nao encontrado.");
    if (
      ["galpao", "rua", "coluna", "nivel", "posicao"].some(
        (key) => before[key] !== a[key as keyof typeof a],
      ) &&
      (
        await c.query(
          "SELECT 1 FROM wms_movements WHERE endereco_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Endereco com historico nao pode mudar de codigo. Bloqueie-o e crie outro.",
      );
    await c.query(
      "INSERT INTO wms_streets(galpao,rua) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [a.galpao, a.rua],
    );
    const after = (
      await c.query(
        "UPDATE wms_addresses SET galpao=$2,rua=$3,coluna=$4,nivel=$5,posicao=$6,bloqueado=$7,motivo_bloqueio=$8 WHERE id=$1 RETURNING *",
        [
          id,
          a.galpao,
          a.rua,
          a.coluna,
          a.nivel,
          a.posicao,
          a.bloqueado,
          a.motivo_bloqueio,
        ],
      )
    ).rows[0];
    await audit(c, actor(req), "ENDERECO_ATUALIZADO", id, before, after);
    return after;
  });
  res.json(row);
});
stockRouter.delete("/addresses/:id", manager, async (req, res) => {
  const id = uuid(req.params.id);
  await transaction(pool, async (c) => {
    const before = (
      await c.query("SELECT * FROM wms_addresses WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!before) throw new HttpError(404, "Endereco nao encontrado.");
    if (
      (
        await c.query(
          "SELECT 1 FROM wms_movements WHERE endereco_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Endereco com historico deve ser bloqueado, nao excluido.",
      );
    await c.query("DELETE FROM wms_addresses WHERE id=$1", [id]);
    await audit(c, actor(req), "ENDERECO_EXCLUIDO", id, before, null);
  });
  res.json({ ok: true });
});
stockRouter.put("/streets", manager, async (req, res) => {
  const a = z
    .object({
      galpao: z.number().int().min(1).max(9),
      rua: z.number().int().min(1).max(99),
      last_column_a: z.number().int().min(1).max(99),
    })
    .parse(req.body);
  await transaction(pool, async (c) => {
    const before = (
      await c.query(
        "SELECT * FROM wms_streets WHERE galpao=$1 AND rua=$2 FOR UPDATE",
        [a.galpao, a.rua],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO wms_streets VALUES($1,$2,$3) ON CONFLICT(galpao,rua) DO UPDATE SET last_column_a=excluded.last_column_a",
      [a.galpao, a.rua, a.last_column_a],
    );
    await audit(
      c,
      actor(req),
      "LADO_DA_RUA",
      `${a.galpao}-${a.rua}`,
      before,
      a,
    );
  });
  res.json(a);
});
stockRouter.post("/addresses/generate", manager, async (req, res) => {
  const n = z.number().int().min(1).max(99);
  const a = z
    .object({
      galpao: z.number().int().min(1).max(9),
      rua: n,
      coluna_de: n,
      coluna_ate: n,
      nivel_de: z.number().int().min(0).max(99),
      nivel_ate: z.number().int().min(0).max(99),
      posicao_de: n,
      posicao_ate: n,
    })
    .parse(req.body);
  if (
    a.coluna_de > a.coluna_ate ||
    a.nivel_de > a.nivel_ate ||
    a.posicao_de > a.posicao_ate
  )
    throw new HttpError(422, "Faixas invalidas.");
  const total =
    (a.coluna_ate - a.coluna_de + 1) *
    (a.nivel_ate - a.nivel_de + 1) *
    (a.posicao_ate - a.posicao_de + 1);
  if (total > 20000)
    throw new HttpError(422, "Gere ate 20.000 enderecos por vez.");
  const inserted = await transaction(pool, async (c) => {
    await c.query(
      "INSERT INTO wms_streets(galpao,rua) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [a.galpao, a.rua],
    );
    const result = await c.query(
      `INSERT INTO wms_addresses(galpao,rua,coluna,nivel,posicao) SELECT $1,$2,c,n,p FROM generate_series($3::int,$4::int)c CROSS JOIN generate_series($5::int,$6::int)n CROSS JOIN generate_series($7::int,$8::int)p ON CONFLICT(codigo) DO NOTHING`,
      [
        a.galpao,
        a.rua,
        a.coluna_de,
        a.coluna_ate,
        a.nivel_de,
        a.nivel_ate,
        a.posicao_de,
        a.posicao_ate,
      ],
    );
    await audit(
      c,
      actor(req),
      "ENDERECOS_GERADOS",
      `${a.galpao}-${a.rua}`,
      null,
      { ...a, inserted: result.rowCount },
    );
    return result.rowCount || 0;
  });
  res.json({ inserted, existentes: total - inserted });
});
stockRouter.post(
  "/addresses/import",
  manager,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, "Selecione o arquivo.");
    const rows = readRows(req.file.buffer, req.file.originalname);
    let inserted = 0;
    const errors: { linha: number; erro: string }[] = [];
    for (const [i, row] of rows.entries())
      try {
        const coords = decomporEndereco(
          String(row.codigo ?? row.endereco ?? "").trim(),
        );
        const bloqueado =
          ["true", "sim", "1"].includes(
            String(row.bloqueado || "")
              .trim()
              .toLowerCase(),
          ) ||
          String(row.status || "")
            .trim()
            .toLowerCase() === "bloqueado";
        const a = addressSchema.parse({
          ...coords,
          bloqueado,
          motivo_bloqueio: String(
            row.motivo_bloqueio ||
              (bloqueado ? "Bloqueio importado do mapa legado" : ""),
          ),
        });
        await transaction(pool, async (c) => {
          await c.query(
            "INSERT INTO wms_streets(galpao,rua) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [a.galpao, a.rua],
          );
          const result = await c.query(
            "INSERT INTO wms_addresses(galpao,rua,coluna,nivel,posicao,bloqueado,motivo_bloqueio) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              a.galpao,
              a.rua,
              a.coluna,
              a.nivel,
              a.posicao,
              a.bloqueado,
              a.motivo_bloqueio,
            ],
          );
          await audit(
            c,
            actor(req),
            "ENDERECO_IMPORTADO",
            result.rows[0].id,
            null,
            a,
          );
        });
        inserted++;
      } catch (error) {
        errors.push({ linha: i + 2, erro: publicError(error) });
      }
    res.json({ inserted, errors });
  },
);
stockRouter.get("/dashboard", async (_req, res) => {
  const [totals, streets, expiry] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE status='Vazio')::int AS vazias,count(*) FILTER(WHERE status='Ocupado')::int AS ocupadas,count(*) FILTER(WHERE status='Bloqueado')::int AS bloqueadas FROM wms_occupancy`,
    ),
    pool.query(
      `SELECT galpao,rua,count(*)::int AS total,count(*) FILTER(WHERE status='Vazio')::int AS vazias,count(*) FILTER(WHERE status='Ocupado')::int AS ocupadas,count(*) FILTER(WHERE status='Bloqueado')::int AS bloqueadas,round(100.0*count(*) FILTER(WHERE status='Vazio')/nullif(count(*),0),1) AS percentual_vazias FROM wms_occupancy GROUP BY galpao,rua ORDER BY galpao,rua`,
    ),
    pool.query(
      `SELECT p.id,p.codigo,p.descricao,sum(b.quantidade)::int AS quantidade,CASE WHEN b.validade<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'Vencido' WHEN b.validade<=(now() AT TIME ZONE 'America/Sao_Paulo')::date+30 THEN '30 dias' WHEN b.validade<=(now() AT TIME ZONE 'America/Sao_Paulo')::date+60 THEN '60 dias' ELSE '90 dias' END AS faixa,min(b.validade)::text AS validade FROM wms_balances b JOIN wms_products p ON p.id=b.produto_id WHERE b.quantidade>0 AND b.validade<=(now() AT TIME ZONE 'America/Sao_Paulo')::date+90 GROUP BY p.id,faixa ORDER BY validade,p.codigo`,
    ),
  ]);
  res.json({
    totals: totals.rows[0],
    streets: streets.rows,
    expiry: expiry.rows,
  });
});
stockRouter.get("/reconciliation", manager, async (_req, res) => {
  const result =
    await pool.query(`WITH ledger AS (SELECT endereco_id,produto_id,validade,sum(quantidade::bigint*sinal) AS quantidade FROM wms_movements GROUP BY endereco_id,produto_id,validade)
    SELECT COALESCE(b.endereco_id,l.endereco_id) AS endereco_id,COALESCE(b.produto_id,l.produto_id) AS produto_id,COALESCE(b.validade,l.validade)::text AS validade,COALESCE(b.quantidade,0) AS saldo,COALESCE(l.quantidade,0) AS ledger
    FROM wms_balances b FULL JOIN ledger l USING(endereco_id,produto_id,validade) WHERE COALESCE(b.quantidade,0)<>COALESCE(l.quantidade,0)`);
  res.json({ checked_at: new Date().toISOString(), divergencias: result.rows });
});
export function publicError(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  if (error instanceof HttpError) return error.message;
  if (typeof error === "object" && error && "code" in error) {
    if (error.code === "23505")
      return "Codigo ou EAN duplicado (unidade/caixa).";
    if (error.code === "23503")
      return "Registro vinculado a outro cadastro; revise os relacionamentos.";
  }
  return "Nao foi possivel processar o registro. Confira o arquivo e os dados.";
}
stockRouter.use(
  (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(422).json({ message: publicError(error) });
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      ["23505", "23503", "23514", "40P01", "40001"].includes(String(error.code))
    )
      return res.status(409).json({ message: publicError(error) });
    next(error);
  },
);
