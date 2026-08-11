import { useEffect, useState } from "react";
import axios from "axios";
import { api, buildApiUrl } from "../lib/api";
import type { DescentRecord, User } from "../types";

type ClosingReportItem = {
  order_number: string;
  route?: string | null;
  lot?: string | null;
  volume?: number | null;
  weight_kg?: number | null;
  description?: string | null;
  operation_date: string;
  delivery_date: string;
};

type ClosingReportCards = {
  expected_orders: number;
  scanned_orders: number;
  pending_orders: number;
  unexpected_orders: number;
  completion_percentage: number;
};

type ClosingExceptions = {
  unexpected: Array<{ order_number: string; scanned_at: string; descended_by_name: string; scans: number }>;
  duplicates: Array<{ order_number: string; scans: number; first_scan_at: string; last_scan_at: string; operators: string }>;
  routes_without_dock: number;
};

type RouteProgress = {
  route: string;
  expected_orders: number;
  scanned_orders: number;
  pending_orders: number;
  completion_percentage: number;
  last_scan_at?: string | null;
};

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return fallback;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function DescentReportsPage({ user: currentUser }: { user: User }) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [order, setOrder] = useState("");
  const [user, setUser] = useState("");
  const [route, setRoute] = useState("");
  const [lot, setLot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<DescentRecord[]>([]);
  const [closingDate, setClosingDate] = useState(isoToday());
  const [closingOrder, setClosingOrder] = useState("");
  const [closingRoute, setClosingRoute] = useState("");
  const [closingLot, setClosingLot] = useState("");
  const [closingLoading, setClosingLoading] = useState(false);
  const [closingError, setClosingError] = useState("");
  const [closingItems, setClosingItems] = useState<ClosingReportItem[]>([]);
  const [closingCards, setClosingCards] = useState<ClosingReportCards | null>(null);
  const [closingUpdatedAt, setClosingUpdatedAt] = useState("");
  const [closingExceptions, setClosingExceptions] = useState<ClosingExceptions>({ unexpected: [], duplicates: [], routes_without_dock: 0 });
  const [closingBase, setClosingBase] = useState<{ imported_at: string; filename: string } | null>(null);
  const [routeProgress, setRouteProgress] = useState<RouteProgress[]>([]);
  const [frozenOrders, setFrozenOrders] = useState<Array<{ order_number: string; classified_by_name: string; created_at: string }>>([]);
  const [classifyingOrder, setClassifyingOrder] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        from,
        to,
        page: "1",
        pageSize: "200"
      });
      if (order.trim()) params.set("order", order.trim());
      if (user.trim()) params.set("user", user.trim());
      if (route.trim()) params.set("route", route.trim());
      if (lot.trim()) params.set("lot", lot.trim());
      const { data } = await api.get(`/descents?${params.toString()}`);
      setItems(data.items || []);
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Falha ao carregar relatorio de descidas."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function closingParams() {
    const params = new URLSearchParams({ date: closingDate });
    if (closingOrder.trim()) params.set("order", closingOrder.trim());
    if (closingRoute.trim()) params.set("route", closingRoute.trim());
    if (closingLot.trim()) params.set("lot", closingLot.trim());
    return params;
  }

  async function loadClosingReport() {
    setClosingLoading(true);
    setClosingError("");
    try {
      const { data } = await api.get(`/descents/closing-report?${closingParams().toString()}`);
      setClosingCards(data.cards || null);
      setClosingItems(data.items || []);
      setClosingExceptions(data.exceptions || { unexpected: [], duplicates: [], routes_without_dock: 0 });
      setClosingBase(data.base || null);
      setRouteProgress(data.route_progress || []);
      setFrozenOrders(data.frozen_orders || []);
      setClosingUpdatedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (err: unknown) {
      setClosingError(apiErrorMessage(err, "Falha ao carregar o fechamento do turno."));
    } finally {
      setClosingLoading(false);
    }
  }

  async function classifyAsFrozen(orderNumber: string) {
    if (!window.confirm(`Classificar o pedido ${orderNumber} como Congelado (CG) e removê-lo das pendências do Seco?`)) return;
    setClassifyingOrder(orderNumber);
    setClosingError("");
    try {
      await api.post("/descents/closing-report/cg", { workDate: closingDate, orderNumber });
      await loadClosingReport();
    } catch (err: unknown) {
      setClosingError(apiErrorMessage(err, "Falha ao classificar o pedido como congelado."));
    } finally {
      setClassifyingOrder("");
    }
  }

  async function undoFrozenClassification(orderNumber: string) {
    if (!window.confirm(`Desfazer a classificacao CG do pedido ${orderNumber}? Ele voltara para as pendencias do Seco.`)) return;
    setClassifyingOrder(orderNumber);
    try {
      await api.delete(`/descents/closing-report/cg/${encodeURIComponent(orderNumber)}?date=${encodeURIComponent(closingDate)}`);
      await loadClosingReport();
    } catch (err: unknown) {
      setClosingError(apiErrorMessage(err, "Falha ao desfazer a classificacao CG."));
    } finally {
      setClassifyingOrder("");
    }
  }

  useEffect(() => {
    if (!closingCards) return;
    const interval = window.setInterval(() => {
      void loadClosingReport();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [closingCards, closingDate, closingOrder, closingRoute, closingLot]);

  async function exportClosingReport() {
    setClosingError("");
    try {
      const response = await api.get(`/descents/closing-report/export?${closingParams().toString()}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pedidos-nao-bipados-${closingDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setClosingError(apiErrorMessage(err, "Falha ao exportar o fechamento do turno."));
    }
  }

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Fechamento do turno</h2>
          <p className="text-sm text-slate-600">Compare os pedidos do turno com a entrega do próximo dia útil.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <input className="border rounded-xl px-3 py-2 md:col-span-2" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-3" placeholder="Pedido" value={closingOrder} onChange={(e) => setClosingOrder(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Rota" value={closingRoute} onChange={(e) => setClosingRoute(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Lote" value={closingLot} onChange={(e) => setClosingLot(e.target.value)} />
          <button type="button" onClick={loadClosingReport} disabled={closingLoading || !closingDate} className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold md:col-span-1 disabled:opacity-50">
            {closingLoading ? "..." : "Analisar"}
          </button>
          <button type="button" onClick={exportClosingReport} disabled={!closingCards || closingLoading} className="rounded-xl border border-amber-500 text-amber-700 px-4 py-2 font-semibold md:col-span-2 disabled:opacity-50">
            Exportar Excel
          </button>
        </div>
        {closingError && <p className="text-sm text-red-700">{closingError}</p>}
        {closingCards && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Previstos</p><p className="text-2xl font-bold">{closingCards.expected_orders}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Bipados</p><p className="text-2xl font-bold text-emerald-800">{closingCards.scanned_orders}</p></div>
              <div className="rounded-xl bg-red-50 p-3"><p className="text-xs text-red-700">Nao bipados</p><p className="text-2xl font-bold text-red-800">{closingCards.pending_orders}</p></div>
              <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-700">Bipados fora da base</p><p className="text-2xl font-bold text-amber-800">{closingCards.unexpected_orders}</p></div>
              <div className="rounded-xl bg-cyan-50 p-3"><p className="text-xs text-cyan-700">Conclusao</p><p className="text-2xl font-bold text-cyan-800">{closingCards.completion_percentage}%</p></div>
            </div>
            <p className="text-xs text-slate-500">Atualizacao automatica a cada 15 segundos{closingUpdatedAt ? ` — ultima atualizacao: ${closingUpdatedAt}` : ""}. Pedidos fora da base nao reduzem as pendencias previstas.</p>
            {closingBase && (
              <div className={`rounded-xl border p-3 text-sm ${closingExceptions.routes_without_dock ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                <strong>Base ativa:</strong> {closingBase.filename}, importada em {new Date(closingBase.imported_at).toLocaleString("pt-BR")}.
                {closingExceptions.routes_without_dock ? ` Existem ${closingExceptions.routes_without_dock} rotas sem doca definida.` : " Todas as rotas estao com doca definida."}
              </div>
            )}
            {(closingExceptions.unexpected.length > 0 || closingExceptions.duplicates.length > 0) && (
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <h3 className="font-semibold text-amber-900">Bipados fora da base ({closingExceptions.unexpected.length})</h3>
                  <div className="mt-2 max-h-48 overflow-auto text-sm">{closingExceptions.unexpected.map((item) => <p key={item.order_number} className="border-b border-amber-200 py-1"><strong>{item.order_number}</strong> — {item.descended_by_name} — {new Date(item.scanned_at).toLocaleTimeString("pt-BR")}</p>)}</div>
                </div>
                <div className="rounded-xl border border-red-300 bg-red-50 p-3">
                  <h3 className="font-semibold text-red-900">Duplicidades ({closingExceptions.duplicates.length})</h3>
                  <div className="mt-2 max-h-48 overflow-auto text-sm">{closingExceptions.duplicates.map((item) => <p key={item.order_number} className="border-b border-red-200 py-1"><strong>{item.order_number}</strong> — {item.scans} leituras — {item.operators}</p>)}</div>
                </div>
              </div>
            )}
            <div className="overflow-auto rounded-xl border">
              <div className="border-b bg-slate-50 px-3 py-2"><h3 className="font-semibold">Andamento por rota</h3><p className="text-xs text-slate-500">Rotas paradas ou ainda nao iniciadas aparecem primeiro pelas pendencias.</p></div>
              <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Rota</th><th>Previstos</th><th>Bipados</th><th>Restantes</th><th>Conclusao</th><th>Ultimo bipe</th></tr></thead><tbody>
                {[...routeProgress].sort((a, b) => b.pending_orders - a.pending_orders).map((item) => <tr key={item.route} className={`border-b ${item.scanned_orders === 0 ? "bg-amber-50" : ""}`}><td className="p-2 font-semibold">{item.route}</td><td>{item.expected_orders}</td><td>{item.scanned_orders}</td><td className={item.pending_orders ? "font-bold text-red-700" : "text-emerald-700"}>{item.pending_orders}</td><td>{item.completion_percentage}%</td><td>{item.last_scan_at ? new Date(item.last_scan_at).toLocaleTimeString("pt-BR") : "Nao iniciada"}</td></tr>)}
              </tbody></table>
            </div>
            <div className="overflow-auto">
              <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Pedidos nao bipados</h3><span className="text-sm text-slate-600">{closingItems.length} pedidos</span></div>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="py-2">Pedido</th><th>Data do turno</th><th>Data da entrega</th><th>Rota</th><th>Lote</th><th>Volumes</th><th>Peso</th><th>Descricao</th><th>Operacao</th></tr></thead>
                <tbody>
                  {closingItems.map((item) => <tr key={item.order_number} className="border-b"><td className="py-2 font-medium">{item.order_number}</td><td>{item.operation_date?.slice(0, 10)}</td><td>{item.delivery_date?.slice(0, 10)}</td><td>{item.route || "-"}</td><td>{item.lot || "-"}</td><td>{item.volume ?? "-"}</td><td>{item.weight_kg ?? "-"}</td><td>{item.description || "-"}</td><td>{(currentUser.role === "admin" || currentUser.role === "supervisor") ? <button type="button" disabled={classifyingOrder === item.order_number} onClick={() => classifyAsFrozen(item.order_number)} className="rounded-lg bg-cyan-700 px-3 py-1 font-bold text-white disabled:opacity-50">{classifyingOrder === item.order_number ? "..." : "CG"}</button> : "-"}</td></tr>)}
                  {!closingItems.length && <tr><td className="py-3 text-slate-500" colSpan={9}>{closingCards.pending_orders === 0 ? "Nenhum pedido pendente para os filtros informados." : "Nenhum registro encontrado."}</td></tr>}
                </tbody>
              </table>
            </div>
            {frozenOrders.length > 0 && (
              <details className="rounded-xl border border-cyan-300 bg-cyan-50 p-3">
                <summary className="cursor-pointer font-semibold text-cyan-900">Pedidos classificados como CG ({frozenOrders.length})</summary>
                <div className="mt-2 max-h-48 overflow-auto text-sm">{frozenOrders.map((item) => <div key={item.order_number} className="flex items-center justify-between gap-3 border-b border-cyan-200 py-1"><p><strong>{item.order_number}</strong> — {item.classified_by_name} — {new Date(item.created_at).toLocaleString("pt-BR")}</p><button type="button" onClick={() => undoFrozenClassification(item.order_number)} className="text-xs font-semibold text-red-700 underline">Desfazer CG</button></div>)}</div>
              </details>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <h2 className="font-semibold mb-3">Relatorio de Descidas</h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <input className="border rounded-xl px-3 py-2 md:col-span-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Pedido"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
          <input
            className="border rounded-xl px-3 py-2 md:col-span-2"
            placeholder="Operador (quem desceu)"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Rota" value={route} onChange={(e) => setRoute(e.target.value)} />
          <input className="border rounded-xl px-3 py-2 md:col-span-1" placeholder="Lote" value={lot} onChange={(e) => setLot(e.target.value)} />
          <button type="button" onClick={load} className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold md:col-span-1">
            {loading ? "..." : "Filtrar"}
          </button>
        </div>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Descidas encontradas</h3>
          <span className="text-sm text-slate-600">{items.length} registros</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Pedido</th>
              <th>Rota</th>
              <th>Peso</th>
              <th>Lote</th>
              <th>Data</th>
              <th>Operador</th>
              <th>Volume</th>
              <th>Cor</th>
              <th>Imagem</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.order_number}</td>
                <td>{item.route || "-"}</td>
                <td>{item.weight_kg ?? "-"}</td>
                <td>{item.lot || "-"}</td>
                <td>{item.work_date?.slice(0, 10)}</td>
                <td>{item.descended_by_name}</td>
                <td>{item.volume ?? "-"}</td>
                <td>{item.pen_color || "-"}</td>
                <td>
                  {item.product_image_path ? (
                    <a className="underline" href={buildApiUrl(item.product_image_path)} target="_blank" rel="noreferrer">
                      abrir
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
            {!items.length && !loading && (
              <tr>
                <td className="py-3 text-slate-500" colSpan={9}>
                  Nenhuma descida encontrada com os filtros informados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

