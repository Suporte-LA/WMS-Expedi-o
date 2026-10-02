import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const password = process.env.WMS_SEED_PASSWORD;
if (!password)
  throw new Error(
    "Defina WMS_SEED_PASSWORD do banco isolado antes dos testes.",
  );
const origin = process.env.STOCK_E2E_URL || "http://127.0.0.1:5181";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("E2E restrito a localhost.");
async function login(page: Page) {
  const result = await page.request.post("/api/auth/login", {
    data: { email: "admin@wms.local", password },
  });
  expect(result.ok()).toBeTruthy();
  const auth = await result.json();
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem("kpi_app_token", token);
    localStorage.setItem("kpi_app_user", JSON.stringify(user));
    localStorage.setItem("wms_last_workspace", "estoque");
  }, auth);
  await page.goto("/estoque");
  await expect(
    page.getByRole("heading", { name: "Estoque endereçado" }),
  ).toBeVisible();
  return auth;
}
async function fixtures(page: Page, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const suffix = Date.now().toString();
  const p = await page.request.post("/api/stock/products", {
    headers,
    data: {
      codigo: "E2E-" + suffix,
      descricao: "Produto E2E " + suffix,
      ean_unidade: "9" + suffix,
      qtd_na_caixa: 12,
    },
  });
  expect(p.status()).toBe(201);
  const product = (await p.json()).produto;
  const addresses = [];
  for (let i = 0; i < 2; i++) {
    const r = await page.request.post("/api/stock/addresses", {
      headers,
      data: {
        galpao: 9,
        rua: 99,
        coluna: 1,
        nivel: Number(suffix.slice(-4, -2)),
        posicao: (Number(suffix.slice(-2)) % 90) + i + 1,
      },
    });
    expect(r.status()).toBe(201);
    addresses.push(await r.json());
  }
  return { product, addresses, headers };
}
test("entrada, transferencia parcial, saida, historico e estorno", async ({
  page,
}) => {
  const auth = await login(page);
  const { product, addresses, headers } = await fixtures(page, auth.token);
  await page.getByRole("button", { name: "Entrada", exact: true }).click();
  await page
    .getByLabel("EAN do produto", { exact: true })
    .fill(product.ean_unidade);
  await page.getByLabel("EAN do produto", { exact: true }).press("Enter");
  await expect(
    page.getByText(`${product.codigo} · ${product.descricao}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Etiqueta do endereço", { exact: true })
    .fill(addresses[0].codigo);
  await page.getByLabel("Etiqueta do endereço", { exact: true }).press("Enter");
  await page.getByLabel("Posição de destino").selectOption(addresses[0].id);
  await page.getByLabel("Quantidade em unidades").fill("10");
  await page.getByLabel("Validade", { exact: true }).fill("2027-12-31");
  await page.getByRole("button", { name: "Confirmar movimento" }).click();
  const source = page
    .locator("article")
    .filter({ hasText: addresses[0].codigo });
  await expect(source.getByText("10 un.", { exact: true })).toBeVisible();
  await source.getByRole("button", { name: "Transferir", exact: true }).click();
  await page
    .getByLabel("Etiqueta do endereço", { exact: true })
    .fill(addresses[1].codigo);
  await page.getByLabel("Etiqueta do endereço", { exact: true }).press("Enter");
  await page.getByLabel("Posição de destino").selectOption(addresses[1].id);
  await page.getByLabel("Quantidade em unidades").fill("4");
  await page.getByRole("button", { name: "Confirmar movimento" }).click();
  await expect(source.getByText("6 un.", { exact: true })).toBeVisible();
  const dest = page.locator("article").filter({ hasText: addresses[1].codigo });
  await expect(dest.getByText("4 un.", { exact: true })).toBeVisible();
  await dest.getByRole("button", { name: "Saída", exact: true }).click();
  await page.getByLabel("Quantidade em unidades").fill("1");
  await page.getByRole("button", { name: "Confirmar movimento" }).click();
  await expect(dest.getByText("3 un.", { exact: true })).toBeVisible();
  await dest.getByRole("button", { name: "Histórico" }).click();
  const out = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "SAIDA", exact: true }) });
  await out.getByRole("button", { name: "Estornar" }).click();
  await page.getByLabel("Motivo do estorno").fill("Teste de correcao");
  await page.getByRole("button", { name: "Confirmar estorno" }).click();
  await expect(
    page.getByRole("cell", { name: "ESTORNO", exact: true }),
  ).toBeVisible();
  const check = await page.request.get("/api/stock/reconciliation", {
    headers,
  });
  expect((await check.json()).divergencias).toEqual([]);
});
test("PWA reabre offline e conflito bloqueia envios posteriores ate resolucao", async ({
  page,
  context,
}) => {
  const auth = await login(page);
  const { product, addresses, headers } = await fixtures(page, auth.token);
  await page.getByRole("button", { name: "Preparar uso offline" }).click();
  await expect(
    page.getByText("Cadastros e enderecos preparados para uso offline."),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Estoque endereçado" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Estoque endereçado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Entrada", exact: true }).click();
  await page
    .getByLabel("EAN do produto", { exact: true })
    .fill(product.ean_unidade);
  await page.getByLabel("EAN do produto", { exact: true }).press("Enter");
  await page
    .getByLabel("Etiqueta do endereço", { exact: true })
    .fill(addresses[0].codigo);
  await page.getByLabel("Etiqueta do endereço", { exact: true }).press("Enter");
  await page.getByLabel("Posição de destino").selectOption(addresses[0].id);
  await page.getByLabel("Quantidade em unidades").fill("2");
  await page.getByLabel("Validade", { exact: true }).fill("2027-12-31");
  await page.getByRole("button", { name: "Salvar na fila offline" }).click();
  await expect(page.getByText("1 envio(s) pendente(s)")).toBeVisible();
  await page.getByRole("button", { name: "Entrada", exact: true }).click();
  await page
    .getByLabel("EAN do produto", { exact: true })
    .fill(product.ean_unidade);
  await page.getByLabel("EAN do produto", { exact: true }).press("Enter");
  await page
    .getByLabel("Etiqueta do endereço", { exact: true })
    .fill(addresses[1].codigo);
  await page.getByLabel("Etiqueta do endereço", { exact: true }).press("Enter");
  await page.getByLabel("Posição de destino").selectOption(addresses[1].id);
  await page.getByLabel("Quantidade em unidades").fill("3");
  await page.getByLabel("Validade", { exact: true }).fill("2027-12-31");
  await page.getByRole("button", { name: "Salvar na fila offline" }).click();
  await expect(page.getByText("2 envio(s) pendente(s)")).toBeVisible();
  // Another collector occupies the destination while this collector is offline.
  const occupied = await page.request.post("/api/stock/operations", {
    headers,
    data: {
      request_id: randomUUID(),
      tipo: "ENTRADA",
      produto_id: product.id,
      endereco_id: addresses[0].id,
      quantidade: 5,
      validade: "2027-12-31",
    },
  });
  expect(occupied.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", {
      name: "Há conflitos na fila. Conferir e resolver →",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Há conflitos na fila. Conferir e resolver →",
    })
    .click();
  await expect(page.getByText(/Endereco ocupado/)).toBeVisible();
  const balance = await page.request.get(
    `/api/stock/addresses/${addresses[0].id}`,
    { headers },
  );
  expect((await balance.json()).quantidade).toBe(5);
  expect(
    (
      await (
        await page.request.get(`/api/stock/addresses/${addresses[1].id}`, {
          headers,
        })
      ).json()
    ).quantidade,
  ).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".stock-queue-item")
    .filter({ hasText: "Requer conferência" })
    .getByRole("button", { name: "Descartar envio" })
    .click();
  await expect(page.getByText("Nenhum envio pendente.")).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/stock/addresses/${addresses[1].id}`, {
          headers,
        })
      ).json()
    ).quantidade,
  ).toBe(3);
});
test("API aplica perfis, importa CSV, bloqueia endereco e exporta historico", async ({
  page,
}) => {
  const auth = await login(page);
  const { product, addresses, headers } = await fixtures(page, auth.token);
  const suffix = randomUUID();
  const created = await page.request.post("/api/users", {
    headers,
    data: {
      name: "Operador E2E",
      email: `${suffix}@test.invalid`,
      password: "e2e-operator-password",
      role: "operator",
      workspace: "estoque",
    },
  });
  expect(created.status()).toBe(201);
  const session = await page.request.post("/api/auth/login", {
    data: {
      email: `${suffix}@test.invalid`,
      password: "e2e-operator-password",
    },
  });
  const operator = await session.json();
  const operatorHeaders = { Authorization: `Bearer ${operator.token}` };
  expect(
    (
      await page.request.post("/api/stock/products", {
        headers: operatorHeaders,
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put("/api/stock/settings", {
        headers: operatorHeaders,
        data: { allow_same_expiry: true, strict_ean: false },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/stock/operations", {
        headers: operatorHeaders,
        data: {
          request_id: randomUUID(),
          tipo: "AJUSTE_INVENTARIO",
          produto_id: product.id,
          endereco_id: addresses[0].id,
          quantidade: 1,
          validade: "2027-12-31",
          observacao: "Inventario indevido",
        },
      })
    ).status(),
  ).toBe(403);
  const input = {
    request_id: randomUUID(),
    tipo: "ENTRADA",
    produto_id: product.id,
    endereco_id: addresses[0].id,
    quantidade: 3,
    validade: "2027-12-31",
    operador_id: auth.user.id,
  };
  const entry = await page.request.post("/api/stock/operations", {
    headers: operatorHeaders,
    data: input,
  });
  expect(entry.status()).toBe(201);
  expect((await entry.json()).movimentos[0].operador_id).toBe(operator.user.id);
  expect(
    (
      await page.request.post("/api/stock/operations", {
        headers: operatorHeaders,
        data: input,
      })
    ).status(),
  ).toBe(201);
  const imported = await page.request.post("/api/stock/products/import", {
    headers,
    multipart: {
      file: {
        name: "cadastro.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `codigo;descricao;ean_unidade\nIMP-${suffix};Produto importado;8${Date.now()}99\nDUP-${suffix};Duplicado;${product.ean_unidade}\n`,
        ),
      },
    },
  });
  const report = await imported.json();
  expect(report.inserted).toBe(1);
  expect(report.errors).toHaveLength(1);
  expect(report.warnings).toHaveLength(1);
  const blocked = await page.request.put(
    `/api/stock/addresses/${addresses[1].id}`,
    {
      headers,
      data: { ...addresses[1], bloqueado: true, motivo_bloqueio: "Manutencao" },
    },
  );
  expect(blocked.ok()).toBeTruthy();
  expect(
    (
      await page.request.post("/api/stock/operations", {
        headers: operatorHeaders,
        data: {
          ...input,
          request_id: randomUUID(),
          endereco_id: addresses[1].id,
        },
      })
    ).status(),
  ).toBe(409);
  for (const type of ["csv", "xlsx"]) {
    const exported = await page.request.get(
      `/api/stock/movements?produto_id=${product.id}&export=${type}`,
      { headers },
    );
    expect(exported.ok()).toBeTruthy();
    expect((await exported.body()).length).toBeGreaterThan(50);
  }
});
test("layout mobile, cadastros, dashboard e usuarios carregam", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const label of ["Produtos", "Endereços", "Dashboard", "Usuários"]) {
    await page
      .getByRole("navigation", { name: "Estoque", exact: true })
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(page.getByText("Carregando tela…")).toHaveCount(0);
    await expect(page.locator(".stock-content table").first()).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.screenshot({
    path: "test-results/stock-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
