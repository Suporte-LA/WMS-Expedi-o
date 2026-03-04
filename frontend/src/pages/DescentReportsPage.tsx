import { useEffect, useState } from "react";
import { api, buildApiUrl } from "../lib/api";
import type { DescentRecord } from "../types";

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
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao carregar relatorio de descidas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="space-y-4">
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

