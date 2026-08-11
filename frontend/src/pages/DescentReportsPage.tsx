import { useEffect, useState } from "react";
import axios from "axios";
import { api, buildApiUrl } from "../lib/api";
import type { DescentRecord } from "../types";

type ClosingReportItem = {
  order_number: string;
  route?: string | null;
  lot?: string | null;
  volume?: number | null;
  weight_kg?: number | null;
  description?: string | null;
  base_date: string;
};

type ClosingReportCards = {
  expected_orders: number;
  scanned_orders: number;
  pending_orders: number;
  completion_percentage: number;
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

export function DescentReportsPage() {
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
    } catch (err: unknown) {
      setClosingError(apiErrorMessage(err, "Falha ao carregar o fechamento do turno."));
    } finally {
      setClosingLoading(false);
    }
  }

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
          <p className="text-sm text-slate-600">Compare a base importada com os pedidos bipados na mesma data.</p>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Previstos</p><p className="text-2xl font-bold">{closingCards.expected_orders}</p></div>
              <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Bipados</p><p className="text-2xl font-bold text-emerald-800">{closingCards.scanned_orders}</p></div>
              <div className="rounded-xl bg-red-50 p-3"><p className="text-xs text-red-700">Nao bipados</p><p className="text-2xl font-bold text-red-800">{closingCards.pending_orders}</p></div>
              <div className="rounded-xl bg-cyan-50 p-3"><p className="text-xs text-cyan-700">Conclusao</p><p className="text-2xl font-bold text-cyan-800">{closingCards.completion_percentage}%</p></div>
            </div>
            <div className="overflow-auto">
              <div className="flex items-center justify-between mb-2"><h3 className="font-semibold">Pedidos nao bipados</h3><span className="text-sm text-slate-600">{closingItems.length} pedidos</span></div>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="py-2">Pedido</th><th>Rota</th><th>Lote</th><th>Volumes</th><th>Peso</th><th>Descricao</th></tr></thead>
                <tbody>
                  {closingItems.map((item) => <tr key={item.order_number} className="border-b"><td className="py-2 font-medium">{item.order_number}</td><td>{item.route || "-"}</td><td>{item.lot || "-"}</td><td>{item.volume ?? "-"}</td><td>{item.weight_kg ?? "-"}</td><td>{item.description || "-"}</td></tr>)}
                  {!closingItems.length && <tr><td className="py-3 text-slate-500" colSpan={6}>{closingCards.pending_orders === 0 ? "Nenhum pedido pendente para os filtros informados." : "Nenhum registro encontrado."}</td></tr>}
                </tbody>
              </table>
            </div>
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

