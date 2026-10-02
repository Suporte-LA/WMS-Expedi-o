import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "../types";
import { Occupancy } from "../stock/Occupancy";
import { OperationForm } from "../stock/OperationForm";
import { Movements } from "../stock/Movements";
import { QueuePanel } from "../stock/QueuePanel";
import {
  listenQueue,
  pendingStock,
  prepareOffline,
  stockRead,
  syncStock,
  type Queued,
} from "../stock/offline";
import type { Address, Bootstrap, Operation } from "../stock/types";
import { messageOf } from "../stock/helpers";
import { Notice } from "../stock/ui";
import "../stock/stock.css";
const Products = lazy(() =>
  import("../stock/Products").then((m) => ({ default: m.Products })),
);
const Addresses = lazy(() =>
  import("../stock/Addresses").then((m) => ({ default: m.Addresses })),
);
const Dashboard = lazy(() =>
  import("../stock/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Users = lazy(() =>
  import("./UsersPage").then((m) => ({ default: m.UsersPage })),
);
type Tab =
  | "occupancy"
  | "entry"
  | "search"
  | "movements"
  | "products"
  | "addresses"
  | "dashboard"
  | "users"
  | "queue"
  | "operation";
export function StockPage({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>("occupancy");
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<Queued[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [productFilter, setProductFilter] = useState<string>();
  const [operation, setOperation] = useState<{
    kind: Operation["tipo"];
    row: Address;
  }>();
  const [history, setHistory] = useState<Address>();
  const bootstrap = useQuery({
    queryKey: ["stock", user.id, "bootstrap"],
    networkMode: "always",
    queryFn: ({ signal }) =>
      stockRead<Bootstrap>(user.id, "/bootstrap", signal),
  });
  const readOnly = bootstrap.data?.readOnly ?? true;
  const manager = !readOnly && ["admin", "supervisor"].includes(user.role);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void pendingStock(user.id)
        .then((rows) => {
          if (active) setPending(rows);
        })
        .catch(() => {
          if (active)
            setError(
              "Armazenamento local indisponível. Não registre movimentos offline neste navegador.",
            );
        });
    const status = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine)
        void syncStock(user.id).catch((e) => {
          if (active) setError(messageOf(e));
        });
    };
    const remove = listenQueue((notice) => {
      refresh();
      if (notice) setMessage(notice);
    });
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    refresh();
    status();
    const timer = window.setInterval(status, 15000);
    return () => {
      active = false;
      remove();
      clearInterval(timer);
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
    };
  }, [user.id]);
  useEffect(() => {
    if (import.meta.env.DEV || !("serviceWorker" in navigator))
      return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/stock.webmanifest";
    document.head.append(link);
    void navigator.serviceWorker
      .register("/stock-sw.js", { scope: "/estoque" })
      .catch(() =>
        setError(
          "Não foi possível preparar a abertura offline. Confira a conexão.",
        ),
      );
    return () => link.remove();
  }, []);
  const tabs: [Tab, string][] = [
    ["occupancy", "Ocupação"],
    ...(!readOnly ? [["entry", "Entrada"]] as [Tab,string][] : []),
    ["search", "Buscar produto"],
    ["movements", "Movimentações"],
    ["dashboard", "Dashboard"],
    ...(manager
      ? ([
          ["products", "Produtos"],
          ["addresses", "Endereços"],
        ] as [Tab, string][])
      : []),
    ...(user.role === "admin"
      ? ([["users", "Usuários"]] as [Tab, string][])
      : []),
    ["queue", `Fila offline${pending.length ? ` (${pending.length})` : ""}`],
  ];
  const select = (value: Tab) => {
    setTab(value);
    setError("");
    if (value === "movements") setHistory(undefined);
  };
  function done(product?: string) {
    setProductFilter(product);
    setTab("occupancy");
    setMessage(
      "Operação registrada. Confira a fila para acompanhar a confirmação ou resolver conflitos.",
    );
  }
  function action(
    kind: "SAIDA" | "TRANSFERENCIA" | "AJUSTE_INVENTARIO",
    row: Address,
  ) {
    if(readOnly){setError('Estoque em consulta. Aguarde a importação e conferência da planilha.');return;}
    if (kind === "AJUSTE_INVENTARIO" && !manager) {
      setError(
        "Inventário disponível apenas para supervisores e administradores.",
      );
      return;
    }
    setOperation({ kind, row });
    setTab("operation");
  }
  return (
    <section className="stock-app">
      <header className="stock-heading">
        <div>
          <p className="stock-eyebrow">LOURENÇO ALIMENTOS · ARMAZÉM</p>
          <h1>Estoque endereçado</h1>
          <p>Movimentação por posição, rastreabilidade por validade.</p>
        </div>
        <span className="stock-dev-badge">{readOnly ? 'Aguardando carga inicial' : import.meta.env.MODE === 'stock' || import.meta.env.DEV ? 'Em desenvolvimento' : 'Estoque online'}</span>
      </header>
      {bootstrap.data?.readOnly && <Notice message="Aguardando a planilha atualizada do sistema atual. O estoque está disponível para consulta; cadastros e lançamentos serão liberados após a importação e conferência dos dados."/>}
      <div className="stock-layout">
        <nav className="stock-nav" aria-label="Estoque">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => select(key)}
              aria-current={tab === key ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="stock-content">
          <div className="stock-connection">
            <span className={online ? "stock-online" : "stock-offline"}>
              {online ? "● Conectado" : "● Offline · dados da última consulta"}
            </span>
            <span>{pending.length} envio(s) pendente(s)</span>
            <button
              disabled={preparing || !online}
              onClick={() => {
                setPreparing(true);
                void prepareOffline(user.id)
                  .catch((e) => setError(messageOf(e)))
                  .finally(() => setPreparing(false));
              }}
            >
              {preparing ? "Preparando…" : "Preparar uso offline"}
            </button>
          </div>
          {pending.some((p) => p.status === "conflict") && (
            <button className="stock-conflict" onClick={() => setTab("queue")}>
              Há conflitos na fila. Conferir e resolver →
            </button>
          )}
          <Notice message={message} />
          <Notice
            error
            message={
              error || (bootstrap.error ? messageOf(bootstrap.error) : "")
            }
          />
          <Suspense fallback={<p role="status">Carregando tela…</p>}>
            {tab === "occupancy" && (
              <Occupancy
                key={productFilter || "all"}
                userId={user.id}
                manager={manager}
                bootstrap={bootstrap.data}
                initialProduct={productFilter}
                onAction={action}
                onHistory={(row) => {
                  setHistory(row);
                  setTab("movements");
                }}
              />
            )}
            {tab === "search" && (
              <Occupancy
                userId={user.id}
                manager={manager}
                bootstrap={bootstrap.data}
                searchOnly
                onAction={action}
                onHistory={(row) => {
                  setHistory(row);
                  setTab("movements");
                }}
              />
            )}
            {tab === "entry" && (
              <OperationForm
                key="entry"
                userId={user.id}
                kind="ENTRADA"
                onDone={done}
                onRegister={manager ? () => setTab("products") : undefined}
              />
            )}
            {tab === "operation" && operation && (
              <OperationForm
                key={operation.kind + operation.row.id}
                userId={user.id}
                kind={operation.kind}
                row={operation.row}
                onDone={done}
              />
            )}
            {tab === "movements" && (
              <Movements
                key={history?.id || "all"}
                userId={user.id}
                manager={manager}
                bootstrap={bootstrap.data}
                address={history}
              />
            )}
            {tab === "products" && manager && <Products userId={user.id} />}
            {tab === "addresses" && manager && <Addresses userId={user.id} />}
            {tab === "dashboard" && (
              <Dashboard
                userId={user.id}
                manager={manager}
                settings={bootstrap.data?.settings}
              />
            )}
            {tab === "users" && user.role === "admin" && (
              <div className="stock-table-wrap">
                <Users currentUser={user} defaultWorkspace="estoque" />
              </div>
            )}
            {tab === "queue" && <QueuePanel items={pending} userId={user.id} />}
          </Suspense>
        </div>
      </div>
    </section>
  );
}
