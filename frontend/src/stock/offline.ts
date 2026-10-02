import { isAxiosError } from "axios";
import { normalizarEan } from "@wms/stock-domain";
import { api } from "../lib/api";
import { getStoredUser } from "../lib/auth";
import { queryClient } from "../lib/queryClient";
import type { Address, Bootstrap, Operation, Page, Product } from "./types";

export type Queued = {
  id: string;
  userId: string;
  created: number;
  payload: Operation;
  status: "pending" | "conflict";
  error?: string;
};
const EVENT = "wms-stock-queue";
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("wms-addressed-stock", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("queue", { keyPath: "id" });
      request.result.createObjectStore("snapshots", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function store<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(name, mode);
    const request = fn(tx.objectStore(name));
    let value: T;
    request.onsuccess = () => {
      value = request.result;
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function snapshot<T>(
  userId: string,
  key: string,
): Promise<T | undefined> {
  const result = await store<{ data: T } | undefined>(
    "snapshots",
    "readonly",
    (s) => s.get(userId + "|" + key),
  );
  return result?.data;
}
export async function cacheSnapshot(
  userId: string,
  key: string,
  data: unknown,
) {
  await store("snapshots", "readwrite", (s) =>
    s.put({ id: userId + "|" + key, data, created: Date.now() }),
  );
}
export async function stockRead<T>(
  userId: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const { data } = await api.get<T>("/stock" + path, { signal });
    await cacheSnapshot(userId, path, data);
    return data;
  } catch (error) {
    if (
      isAxiosError(error) &&
      !error.response &&
      error.code !== "ERR_CANCELED"
    ) {
      const cached = await snapshot<T>(userId, path);
      if (cached !== undefined) return cached;
      if (path.startsWith("/occupancy?")) {
        const all = await snapshot<Address[]>(userId, "addresses");
        if (all) {
          const params = new URLSearchParams(path.split("?")[1]);
          const q = (params.get("q") || "").toLowerCase();
          const rows = all.filter(
            (a) =>
              (params.get("com_saldo") !== "1" || a.quantidade > 0) &&
              (!params.get("validade_de") ||
                (a.validade && a.validade > params.get("validade_de")!)) &&
              ["galpao", "rua", "lado", "status", "produto_id"].every(
                (key) =>
                  !params.get(key) ||
                  String(a[key as keyof Address]) === params.get(key),
              ) &&
              (!params.get("validade") ||
                (a.validade && a.validade <= params.get("validade")!)) &&
              (!q ||
                a.codigo === q ||
                [a.produto_codigo, a.descricao].some((v) =>
                  v?.toLowerCase().includes(q),
                ) ||
                [a.ean_unidade, a.ean_caixa].includes(normalizarEan(q))),
          );
          rows.sort(
            (a, b) =>
              (a.validade || "9999").localeCompare(b.validade || "9999") ||
              a.codigo.localeCompare(b.codigo),
          );
          const page = Number(params.get("page") || 1),
            pageSize = Number(params.get("pageSize") || 30);
          return {
            items: rows.slice((page - 1) * pageSize, page * pageSize),
            total: rows.length,
            page,
            pageSize,
          } as T;
        }
      }
    }
    throw error;
  }
}
function notify(message?: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}
export function listenQueue(fn: (message?: string) => void) {
  const listener = (event: Event) => fn((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
export async function pendingStock(userId: string) {
  const all = await store<Queued[]>("queue", "readonly", (s) => s.getAll());
  return all
    .filter((r) => r.userId === userId)
    .sort((a, b) => a.created - b.created);
}
export async function enqueueStock(userId: string, payload: Operation) {
  await store("queue", "readwrite", (s) =>
    s.add({
      id: payload.request_id,
      userId,
      created: Date.now(),
      payload,
      status: "pending",
    } satisfies Queued),
  );
  notify();
  await syncStock(userId);
}
export async function resolveQueue(
  item: Queued,
  action: "retry" | "discard",
  payload?: Operation,
) {
  if (item.userId !== getStoredUser()?.id)
    throw new Error("Entre com o usuario que registrou a operacao.");
  if (action === "discard")
    await store("queue", "readwrite", (s) => s.delete(item.id));
  else
    await store("queue", "readwrite", (s) =>
      s.put({
        ...item,
        payload: payload || item.payload,
        status: "pending",
        error: undefined,
      }),
    );
  notify();
  await syncStock(item.userId);
}
let syncing: Promise<void> | undefined;
export function syncStock(userId: string): Promise<void> {
  if (syncing) return syncing;
  const execute = async () => {
    if (!navigator.onLine || getStoredUser()?.id !== userId) return;
    for (const entry of await pendingStock(userId)) {
      if (entry.status === "conflict" || getStoredUser()?.id !== userId) break;
      try {
        const { data } = await api.post<{ avisos: string[] }>(
          "/stock/operations",
          entry.payload,
        );
        await store("queue", "readwrite", (s) => s.delete(entry.id));
        void queryClient.invalidateQueries({ queryKey: ["stock"] });
        notify(data.avisos.join(" ") || "Movimento confirmado no servidor.");
      } catch (error) {
        if (
          isAxiosError(error) &&
          (!error.response || error.response.status >= 500)
        )
          break;
        const message = isAxiosError<{ message: string }>(error)
          ? error.response?.data.message
          : "Falha ao sincronizar.";
        await store("queue", "readwrite", (s) =>
          s.put({
            ...entry,
            status: "conflict",
            error: message || "Conflito: confira os dados.",
          }),
        );
        notify();
        break;
      }
    }
  };
  const run = async () => {
    if (navigator.locks)
      await navigator.locks.request(
        "wms-stock-sync",
        { ifAvailable: true },
        async (lock) => {
          if (lock) await execute();
        },
      );
    else await execute();
  };
  const pending = run().finally(() => {
    syncing = undefined;
  });
  syncing = pending;
  return pending;
}
export async function prepareOffline(userId: string) {
  for (const [path, key] of [
    ["/products", "catalog"],
    ["/occupancy", "addresses"],
  ]) {
    const items: unknown[] = [];
    for (let page = 1; page <= 1000; page++) {
      const data = (
        await api.get<Page<unknown>>(`/stock${path}`, {
          params: { page, pageSize: 100 },
        })
      ).data;
      items.push(...data.items);
      if (items.length >= data.total || !data.items.length) break;
    }
    await cacheSnapshot(userId, key, items);
  }
  await stockRead(userId, "/bootstrap");
  notify("Cadastros e enderecos preparados para uso offline.");
}
export async function resolveProduct(
  userId: string,
  raw: string,
): Promise<Product> {
  try {
    return await stockRead<Product>(
      userId,
      "/lookup/" + encodeURIComponent(raw),
    );
  } catch (error) {
    if (navigator.onLine) throw error;
    const code = normalizarEan(raw);
    const catalog = (await snapshot<Product[]>(userId, "catalog")) || [];
    const product =
      catalog.find((p) => p.ativo && p.ean_unidade === code) ||
      catalog.find((p) => p.ativo && p.ean_caixa === code);
    if (!product)
      throw new Error(
        "Codigo nao disponivel offline. Prepare os cadastros com conexao.",
      );
    return {
      ...product,
      embalagem: product.ean_unidade === code ? "UNIDADE" : "CAIXA",
      ean_lido: code,
    };
  }
}
export async function availableAddresses(
  userId: string,
  q: string,
  match?: { productId: string; expiry: string },
) {
  const bootstrap = match
    ? await stockRead<Bootstrap>(userId, "/bootstrap")
    : undefined;
  const allowSame = Boolean(
    match?.expiry && bootstrap?.settings.allow_same_expiry,
  );
  const suitable = (a: Address) =>
    a.status === "Vazio" ||
    (allowSame &&
      !a.bloqueado &&
      a.produto_id === match!.productId &&
      a.validade === match!.expiry);
  if (navigator.onLine) {
    const rows = (
      await stockRead<Page<Address>>(
        userId,
        "/occupancy?status=Vazio&pageSize=100" +
          (q ? "&q=" + encodeURIComponent(q) : ""),
      )
    ).items;
    if (allowSame) {
      const occupied = (
        await stockRead<Page<Address>>(
          userId,
          `/occupancy?produto_id=${match!.productId}&pageSize=100` +
            (q ? "&q=" + encodeURIComponent(q) : ""),
        )
      ).items;
      rows.push(...occupied.filter(suitable));
    }
    return rows;
  }
  const rows = (await snapshot<Address[]>(userId, "addresses")) || [];
  return rows
    .filter((a) => suitable(a) && (!q || a.codigo.includes(q)))
    .slice(0, 100);
}
