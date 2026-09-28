import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { format, parseISO } from "date-fns";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from "recharts";
import { api } from "../lib/api";

import type { RankingItem } from "../hooks/useDashboard";
import { useDashboard } from "../hooks/useDashboard";
import { queryClient } from "../lib/queryClient";
import { errorMessage } from "../lib/errorMessage";
import { PageState } from "../components/PageState";

function isoToday() {
  return format(new Date(), "yyyy-MM-dd");
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return format(date, "yyyy-MM-dd");
}

function normalizeDateParam(value: string) {
  const v = value.trim();
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return v;
}

export function DashboardPage() {
  const [from, setFrom] = useState(isoDaysAgo(365));
  const [to, setTo] = useState(isoToday());
  const [user, setUser] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const [filters, setFilters] = useState({ from, to, user });
  const [exportError, setExportError] = useState("");
  const { kpi, rankings } = useDashboard(filters, page, pageSize);
  const cards = kpi.data?.cards;
  const trend = kpi.data?.trend;
  const items = kpi.data?.items;
  const rankingOrders = rankings.data?.orders;
  const rankingBoxes = rankings.data?.boxes;
  const rankingWeight = rankings.data?.weight;
  const loading = kpi.isFetching || rankings.isFetching;
  const queryError = kpi.error || rankings.error;
  const error = exportError || (queryError ? errorMessage(queryError, "Erro ao carregar dashboard.") : "");

  const trendData = useMemo(
    () =>
      (trend || []).map((item) => ({
        ...item,
        label: format(parseISO(item.work_date.slice(0, 10)), "dd/MM")
      })),
    [trend]
  );

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    (rankingOrders || []).forEach((r) => set.add(r.user_name));
    return [...set];
  }, [rankingOrders]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items || [];
    return (items || []).filter((i) => {
      return (
        i.user_name.toLowerCase().includes(q) ||
        String(i.orders_count).includes(q) ||
        String(i.boxes_count).includes(q) ||
        String(i.weight_kg).includes(q) ||
        format(parseISO(i.work_date.slice(0, 10)), "dd/MM/yyyy").includes(q)
      );
    });
  }, [items, search]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setExportError("");
    const next = { from: normalizeDateParam(from), to: normalizeDateParam(to), user };
    if (JSON.stringify(next) === JSON.stringify(filters)) void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    setFilters(next);
  }

  async function exportXlsx() {
    const fromParam = normalizeDateParam(from);
    const toParam = normalizeDateParam(to);
    const params = new URLSearchParams({ from: fromParam, to: toParam, export: "xlsx" });
    if (user) params.set("user", user);
    try {
      const response = await api.get(`/kpi?${params.toString()}`, { responseType: "blob" });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "kpi_export.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setExportError(errorMessage(err, "Falha ao exportar XLSX."));
    }
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onFilter} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg border border-cyan-500 text-cyan-700 px-3 py-1">
            Atualizar
          </button>
          <button type="button" onClick={exportXlsx} className="rounded-lg border border-amber-500 text-amber-700 px-3 py-1">
            Exportar XLSX
          </button>
        </div>

        <div className="grid md:grid-cols-5 gap-3">
          <select aria-label="Operador" className="border rounded-xl px-3 py-2" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">TODOS OS OPERADORES</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <input className="border rounded-xl px-3 py-2" type="date" aria-label="Data inicial" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="border rounded-xl px-3 py-2" type="date" aria-label="Data final" value={to} onChange={(e) => setTo(e.target.value)} />
          <input
            className="border rounded-xl px-3 py-2"
            aria-label="Buscar na tabela"
            placeholder="Buscar na tabela"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="rounded-xl bg-green-600 text-white font-semibold">Filtrar</button>
        </div>
      </form>

      {error && <PageState error message={error} />}
      {loading && <PageState />}

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
                <td>{format(parseISO(row.work_date.slice(0, 10)), "dd/MM/yyyy")}</td>
              </tr>
            ))}
            {!filteredItems.length && (
              <tr>
                <td className="py-3 text-slate-500" colSpan={5}>
                  Nenhum registro para o filtro selecionado.
                </td>
              </tr>
            )}
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
        <RankingChart title="Top Pedidos" data={rankingOrders || []} />
        <RankingChart title="Top Caixas" data={rankingBoxes || []} />
        <RankingChart title="Top KG" data={rankingWeight || []} />
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
