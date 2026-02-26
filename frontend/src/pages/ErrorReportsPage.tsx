import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell, BarChart, Bar, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import type { ErrorRecord } from "../types";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const COLORS = ["#0f766e", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

type ErrorDash = {
  byProblem: { problem_type: string; total: number }[];
  byConferente: { conferente_name: string; total: number }[];
  byUser: { user_name: string; total: number }[];
};

export function ErrorReportsPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [items, setItems] = useState<ErrorRecord[]>([]);
  const [dash, setDash] = useState<ErrorDash | null>(null);
  const [error, setError] = useState("");

  async function loadData() {
    setError("");
    try {
      const [list, dashboard] = await Promise.all([
        api.get(`/errors?from=${from}&to=${to}&page=1&pageSize=100`),
        api.get(`/errors/dashboard?from=${from}&to=${to}`)
      ]);
      setItems(list.data.items || []);
      setDash(dashboard.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao carregar relatorios de erros.");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function onFilter(e: FormEvent) {
    e.preventDefault();
    await loadData();
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onFilter} className="bg-white rounded-2xl p-4 shadow-sm grid md:grid-cols-3 gap-3">
        <input className="border rounded-xl px-3 py-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="border rounded-xl px-3 py-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="rounded-xl border border-slate-300 font-semibold">Atualizar</button>
      </form>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm h-72">
          <h3 className="font-semibold mb-2">Problemas encontrados</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dash?.byProblem || []} dataKey="total" nameKey="problem_type" outerRadius={100}>
                {(dash?.byProblem || []).map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm h-72">
          <h3 className="font-semibold mb-2">Erros por conferente</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dash?.byConferente || []}>
              <XAxis dataKey="conferente_name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="total" fill="#0f766e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
        <h3 className="font-semibold mb-3">Lista de erros</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Problema</th>
              <th>Conferente</th>
              <th>Pedido</th>
              <th>Usuario</th>
              <th>Cor</th>
              <th>Finalizado</th>
              <th>Data</th>
              <th>Imagem</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.problem_type}</td>
                <td>{item.conferente_name}</td>
                <td>{item.order_number}</td>
                <td>{item.descended_user_name || "-"}</td>
                <td>{item.pen_color || "-"}</td>
                <td>{item.finalized ? "SIM" : "NAO"}</td>
                <td>{item.report_date?.slice(0, 10)}</td>
                <td>
                  {item.evidence_image_path ? (
                    <a className="underline" href={`/api${item.evidence_image_path}`} target="_blank">
                      abrir
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
