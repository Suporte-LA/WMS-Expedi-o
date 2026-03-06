import { useEffect, useState } from "react";
import { api } from "../lib/api";

type TiSection = "registro" | "controle";

export function TiPage() {
  const [activeSection, setActiveSection] = useState<TiSection>("registro");
  const [maintenanceItem, setMaintenanceItem] = useState("");
  const [name, setName] = useState("");
  const [operation, setOperation] = useState("");
  const [phoneModel, setPhoneModel] = useState("");
  const [tabletModel, setTabletModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [from, setFrom] = useState(() => new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterName, setFilterName] = useState("");
  const [filterOperation, setFilterOperation] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [controlLoading, setControlLoading] = useState(false);
  const [limits, setLimits] = useState<Array<any>>([]);
  const [monthly, setMonthly] = useState<Array<any>>([]);

  async function submitRecord() {
    setError("");
    setMessage("");
    if (!maintenanceItem.trim() || !name.trim() || !operation.trim()) {
      setError("Preencha Manutencao, Nome e Operacao.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/ti/records", {
        maintenanceItem,
        name,
        operation,
        phoneModel: phoneModel || undefined,
        tabletModel: tabletModel || undefined
      });
      setMessage("Registro salvo.");
      setMaintenanceItem("");
      setName("");
      setOperation("");
      setPhoneModel("");
      setTabletModel("");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao salvar registro.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadControl() {
    setControlLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (filterName.trim()) params.set("name", filterName.trim());
      if (filterOperation.trim()) params.set("operation", filterOperation.trim());
      if (filterItem.trim()) params.set("item", filterItem.trim());
      const { data } = await api.get(`/ti/control?${params.toString()}`);
      setLimits(data.limits || []);
      setMonthly(data.monthly || []);
    } finally {
      setControlLoading(false);
    }
  }

  useEffect(() => {
    if (activeSection === "controle") {
      loadControl();
    }
  }, [activeSection]);

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold">TI</h2>
            <p className="text-sm text-slate-600">Central de TI para registrar e acompanhar aparelhos de vendas.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveSection("registro")}
              className={`rounded-lg px-3 py-1 text-sm ${activeSection === "registro" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Registro de aparelho de vendas
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("controle")}
              className={`rounded-lg px-3 py-1 text-sm ${activeSection === "controle" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Controle de aparelhos de vendas
            </button>
          </div>
        </div>
      </div>

      {activeSection === "registro" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px]">
          <h3 className="font-semibold">Registro de aparelho de vendas</h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className="border rounded-xl px-3 py-2" placeholder="Manutencao (ex: Pelicula)" value={maintenanceItem} onChange={(e) => setMaintenanceItem(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Operacao (ex: vendas 02)" value={operation} onChange={(e) => setOperation(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Celulares (modelo)" value={phoneModel} onChange={(e) => setPhoneModel(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Tablets (modelo)" value={tabletModel} onChange={(e) => setTabletModel(e.target.value)} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={submitRecord}
              className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold"
              disabled={submitting}
            >
              {submitting ? "Salvando..." : "Registrar"}
            </button>
            {message && <span className="text-sm text-emerald-700">{message}</span>}
            {error && <span className="text-sm text-red-700">{error}</span>}
          </div>
        </div>
      )}

      {activeSection === "controle" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px]">
          <h3 className="font-semibold">Controle de aparelhos de vendas</h3>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-6 gap-3">
            <input className="border rounded-xl px-3 py-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Nome" value={filterName} onChange={(e) => setFilterName(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Operacao" value={filterOperation} onChange={(e) => setFilterOperation(e.target.value)} />
            <input className="border rounded-xl px-3 py-2" placeholder="Manutencao" value={filterItem} onChange={(e) => setFilterItem(e.target.value)} />
            <button type="button" onClick={loadControl} className="rounded-xl border px-3 py-2">
              {controlLoading ? "..." : "Atualizar"}
            </button>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="rounded-xl border p-3 overflow-auto">
              <h4 className="font-semibold mb-2">Limite por colaborador</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1">Nome</th>
                    <th>Operacao</th>
                    <th>Manutencao</th>
                    <th>Qtde</th>
                    <th>Janela (meses)</th>
                    <th>Limite</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((row, idx) => (
                    <tr key={`${row.name}-${row.operation}-${row.maintenance_item}-${idx}`} className="border-b">
                      <td className="py-1">{row.name}</td>
                      <td>{row.operation}</td>
                      <td>{row.maintenance_item}</td>
                      <td>{row.total_count}</td>
                      <td>{row.months_limit}</td>
                      <td>{row.max_count}</td>
                      <td className={row.status === "fora_do_limite" ? "text-red-700 font-semibold" : "text-emerald-700"}>
                        {row.status === "fora_do_limite" ? "Fora do limite" : "Dentro do limite"}
                      </td>
                    </tr>
                  ))}
                  {!limits.length && (
                    <tr>
                      <td colSpan={7} className="py-2 text-slate-500">Nenhum registro no periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border p-3 overflow-auto">
              <h4 className="font-semibold mb-2">Indicador mensal</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1">Mes</th>
                    <th>Nome</th>
                    <th>Operacao</th>
                    <th>Manutencao</th>
                    <th>Qtde</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((row, idx) => (
                    <tr key={`${row.month}-${row.name}-${row.operation}-${row.maintenance_item}-${idx}`} className="border-b">
                      <td className="py-1">{row.month}</td>
                      <td>{row.name}</td>
                      <td>{row.operation}</td>
                      <td>{row.maintenance_item}</td>
                      <td>{row.total_count}</td>
                    </tr>
                  ))}
                  {!monthly.length && (
                    <tr>
                      <td colSpan={5} className="py-2 text-slate-500">Nenhum indicador no periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
