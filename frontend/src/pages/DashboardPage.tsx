import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { format } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from "recharts";
import { api } from "../lib/api";

type CardData = {
  total_orders: string;
  total_boxes: string;
  total_weight: string;
};

type TrendItem = {
  work_date: string;
  orders_count: number;
  boxes_count: number;
  weight_kg: number;
};

type RankingItem = {
  user_name: string;
  metric_value: number;
};

type KpiItem = {
  id: string;
  user_name: string;
  orders_count: number;
  boxes_count: number;
  weight_kg: number;
  work_date: string;
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const [from, setFrom] = useState(isoDaysAgo(365));
  const [to, setTo] = useState(isoToday());
  const [user, setUser] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const [cards, setCards] = useState<CardData | null>(null);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [items, setItems] = useState<KpiItem[]>([]);
  const [rankingOrders, setRankingOrders] = useState<RankingItem[]>([]);
  const [rankingBoxes, setRankingBoxes] = useState<RankingItem[]>([]);
  const [rankingWeight, setRankingWeight] = useState<RankingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, page: String(page), pageSize: String(pageSize) });
      if (user) params.set("user", user);

      const [kpi, orders, boxes, weight] = await Promise.all([
        api.get(`/kpi?${params.toString()}`),
        api.get(`/kpi/ranking?from=${from}&to=${to}&metric=orders`),
        api.get(`/kpi/ranking?from=${from}&to=${to}&metric=boxes`),
        api.get(`/kpi/ranking?from=${from}&to=${to}&metric=weight`)
      ]);

      setCards(kpi.data.cards);
      setTrend(kpi.data.trend);
      setItems(kpi.data.items || []);
      setRankingOrders(orders.data.items || []);
      setRankingBoxes(boxes.data.items || []);
      setRankingWeight(weight.data.items || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao carregar dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [page, pageSize]);

  const trendData = useMemo(
    () =>
      trend.map((item) => ({
        ...item,
        label: format(new Date(item.work_date), "dd/MM")
      })),
    [trend]
  );

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    rankingOrders.forEach((r) => set.add(r.user_name));
    return [...set];
  }, [rankingOrders]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      return (
        i.user_name.toLowerCase().includes(q) ||
        String(i.orders_count).includes(q) ||
        String(i.boxes_count).includes(q) ||
        String(i.weight_kg).includes(q) ||
        format(new Date(i.work_date), "dd/MM/yyyy").includes(q)
      );
    });
  }, [items, search]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    loadData();
  }

  function exportCsv() {
    const params = new URLSearchParams({ from, to, export: "csv" });
    if (user) params.set("user", user);
    window.open(`/api/kpi?${params.toString()}`, "_blank");
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onFilter} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg border border-cyan-500 text-cyan-700 px-3 py-1">
            Atualizar
          </button>
          <button type="button" onClick={exportCsv} className="rounded-lg border border-amber-500 text-amber-700 px-3 py-1">
            Exportar CSV
          </button>
        </div>

        <div className="grid md:grid-cols-5 gap-3">
          <select className="border rounded-xl px-3 py-2" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">TODOS OS OPERADORES</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <input className="border rounded-xl px-3 py-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="border rounded-xl px-3 py-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <input
            className="border rounded-xl px-3 py-2"
            placeholder="Buscar na tabela"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="rounded-xl bg-green-600 text-white font-semibold">Filtrar</button>
        </div>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Carregando...</p>}

      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Total Pedidos" value={cards?.total_orders || "0"} />
        <Card title="Total Caixas" value={cards?.total_boxes || "0"} />
        <Card title="Total KG" value={Number(cards?.total_weight || 0).toFixed(2)} />
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm h-72">
        <h3 className="font-semibold mb-2">Tendencia diaria</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData}>
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Line dataKey="orders_count" stroke="#0f766e" name="Pedidos" />
            <Line dataKey="boxes_count" stroke="#0284c7" name="Caixas" />
            <Line dataKey="weight_kg" stroke="#f59e0b" name="KG" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-semibold">Mostrar</label>
          <select
            className="border rounded-lg px-2 py-1"
            value={pageSize}
            onChange={(e) => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="text-sm">registros</span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-slate-50">
              <th className="py-2">USUARIO</th>
              <th>PEDIDOS</th>
              <th>VOLUME</th>
              <th>PESO</th>
              <th>DATA</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="py-2">{row.user_name}</td>
                <td>{row.orders_count}</td>
                <td>{row.boxes_count}</td>
                <td>{row.weight_kg}</td>
                <td>{format(new Date(row.work_date), "dd/MM/yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border px-3 py-1"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span className="text-sm self-center">Pagina {page}</span>
          <button className="rounded-lg border px-3 py-1" type="button" onClick={() => setPage((p) => p + 1)}>
            Proxima
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <RankingChart title="Top Pedidos" data={rankingOrders} />
        <RankingChart title="Top Caixas" data={rankingBoxes} />
        <RankingChart title="Top KG" data={rankingWeight} />
      </div>
    </section>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <article className="bg-white rounded-2xl p-4 shadow-sm">
      <p className="text-slate-500 text-sm">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </article>
  );
}

function RankingChart({ title, data }: { title: string; data: RankingItem[] }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm h-72">
      <h3 className="font-semibold mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="user_name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="metric_value" fill="#0f766e" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
