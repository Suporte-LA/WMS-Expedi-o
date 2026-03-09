import { useEffect, useState } from "react";
import { api } from "../lib/api";

type TiSection = "registro" | "controle" | "base";

function normalizeOperation(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sortOperation(a: string, b: string) {
  const aa = normalizeOperation(a);
  const bb = normalizeOperation(b);

  const parse = (raw: string) => {
    const match = raw.match(/^(vendas|cg)\s*(\d+)/i);
    if (match) {
      return {
        group: match[1].toLowerCase() === "vendas" ? 0 : 1,
        num: Number(match[2]),
        raw
      };
    }
    return { group: 2, num: Number.POSITIVE_INFINITY, raw };
  };

  const pa = parse(aa);
  const pb = parse(bb);

  if (pa.group !== pb.group) return pa.group - pb.group;
  if (pa.num !== pb.num) return pa.num - pb.num;
  return pa.raw.localeCompare(pb.raw, "pt-BR");
}

export function TiPage() {
  const [activeSection, setActiveSection] = useState<TiSection>("registro");
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingHistory, setImportingHistory] = useState(false);
  const [catalog, setCatalog] = useState<Array<any>>([]);
  const [maintenanceOptions, setMaintenanceOptions] = useState<Array<string>>([]);
  const [deviceType, setDeviceType] = useState<"phone" | "tablet" | "">("");
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

  async function loadCatalog() {
    const { data } = await api.get("/ti/catalog/options");
    setCatalog(data.catalog || []);
    setMaintenanceOptions(data.maintenanceItems || []);
  }

  async function submitRecord() {
    setError("");
    setMessage("");
    if (!maintenanceItem.trim() || !name.trim() || !operation.trim()) {
      setError("Preencha Manutencao, Nome e Operacao.");
      return;
    }
    if ((maintenanceItem || "").toLowerCase().includes("pelicula") || (maintenanceItem || "").toLowerCase().includes("capinha")) {
      if (!deviceType) {
        setError("Selecione Celular ou Tablet.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const sendPhone = deviceType === "phone" ? phoneModel : maintenanceItem.toLowerCase().includes("celular") ? phoneModel : "";
      const sendTablet = deviceType === "tablet" ? tabletModel : maintenanceItem.toLowerCase().includes("tablet") ? tabletModel : "";
      await api.post("/ti/records", {
        maintenanceItem,
        name,
        operation,
        phoneModel: sendPhone || undefined,
        tabletModel: sendTablet || undefined
      });
      setMessage("Registro salvo.");
      setMaintenanceItem("");
      setName("");
      setOperation("");
      setPhoneModel("");
      setTabletModel("");
      setDeviceType("");
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

  async function importBase() {
    setError("");
    setMessage("");
    if (!baseFile) {
      setError("Selecione a base para importar.");
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", baseFile);
      const { data } = await api.post("/ti/catalog/import", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage(
        `Base importada. Processadas: ${data.summary.processedRows}, Inseridas: ${data.summary.insertedRows}, Atualizadas: ${data.summary.updatedRows}, Limites: ${data.summary.limitsUpdated}`
      );
      setBaseFile(null);
      await loadCatalog();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao importar base.");
    } finally {
      setImporting(false);
    }
  }

  async function importHistory() {
    setError("");
    setMessage("");
    if (!historyFile) {
      setError("Selecione o arquivo de historico.");
      return;
    }
    setImportingHistory(true);
    try {
      const form = new FormData();
      form.append("file", historyFile);
      const { data } = await api.post("/ti/history/import", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage(`Historico importado. Processadas: ${data.summary.processedRows}, Inseridas: ${data.summary.insertedRows}`);
      setHistoryFile(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao importar historico.");
    } finally {
      setImportingHistory(false);
    }
  }

  useEffect(() => {
    if (activeSection === "controle") {
      loadControl();
    }
  }, [activeSection]);

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    if (!name || !operation) return;
    const match = catalog.find(
      (c) =>
        String(c.name).toLowerCase() === String(name).toLowerCase() &&
        String(c.operation).toLowerCase() === String(operation).toLowerCase()
    );
    if (!match) return;
    setOperation(match.operation || "");
    if (match.phone_model) setPhoneModel(match.phone_model);
    if (match.tablet_model) setTabletModel(match.tablet_model);
  }, [name, operation, catalog]);

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
            <button
              type="button"
              onClick={() => setActiveSection("base")}
              className={`rounded-lg px-3 py-1 text-sm ${activeSection === "base" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Base de dados
            </button>
          </div>
        </div>
      </div>

      {activeSection === "registro" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px]">
          <h3 className="font-semibold">Registro de aparelho de vendas</h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <select className="border rounded-xl px-3 py-2" value={maintenanceItem} onChange={(e) => setMaintenanceItem(e.target.value)}>
              <option value="">Manutencao</option>
              {maintenanceOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <select className="border rounded-xl px-3 py-2" value={operation} onChange={(e) => setOperation(e.target.value)}>
              <option value="">Operacao</option>
              {Array.from(new Set(catalog.map((c) => c.operation).filter(Boolean))).sort(sortOperation).map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <select className="border rounded-xl px-3 py-2" value={name} onChange={(e) => setName(e.target.value)}>
              <option value="">Nome</option>
              {catalog
                .filter((c) => String(c.operation).toLowerCase() === String(operation).toLowerCase())
                .map((c) => c.name)
                .filter(Boolean)
                .map((n: string) => (
                  <option key={n} value={n}>{n}</option>
                ))}
            </select>
            {["pelicula", "capinha"].some((k) => (maintenanceItem || "").toLowerCase().includes(k)) && (
              <select className="border rounded-xl px-3 py-2" value={deviceType} onChange={(e) => setDeviceType(e.target.value as "phone" | "tablet" | "")}>
                <option value="">Celular ou Tablet</option>
                <option value="phone">Celular</option>
                <option value="tablet">Tablet</option>
              </select>
            )}
            {((maintenanceItem || "").toLowerCase().includes("celular") || deviceType === "phone") && (
              <select className="border rounded-xl px-3 py-2" value={phoneModel} onChange={(e) => setPhoneModel(e.target.value)}>
                <option value="">Celulares (modelo)</option>
                {catalog
                  .filter((c) => String(c.operation).toLowerCase() === String(operation).toLowerCase())
                  .filter((c) => String(c.name).toLowerCase() === String(name).toLowerCase())
                  .map((c) => c.phone_model)
                  .filter(Boolean)
                  .map((m: string) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
              </select>
            )}
            {((maintenanceItem || "").toLowerCase().includes("tablet") || deviceType === "tablet") && (
              <select className="border rounded-xl px-3 py-2" value={tabletModel} onChange={(e) => setTabletModel(e.target.value)}>
                <option value="">Tablets (modelo)</option>
                {catalog
                  .filter((c) => String(c.operation).toLowerCase() === String(operation).toLowerCase())
                  .filter((c) => String(c.name).toLowerCase() === String(name).toLowerCase())
                  .map((c) => c.tablet_model)
                  .filter(Boolean)
                  .map((m: string) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
              </select>
            )}
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

      {activeSection === "base" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px] space-y-3">
          <h3 className="font-semibold">Base de dados</h3>
          <p className="text-sm text-slate-600">Importe a base para preencher nomes e modelos nos formulários.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="ti-base-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setBaseFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="ti-base-upload" className="rounded-xl border px-3 py-2 cursor-pointer">
              Escolher base
            </label>
            <span className="text-sm text-slate-500">{baseFile?.name || "Nenhum arquivo selecionado"}</span>
            <button type="button" onClick={importBase} className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold" disabled={importing}>
              {importing ? "Importando..." : "Importar Base"}
            </button>
          </div>
          <div className="pt-2 border-t flex flex-wrap items-center gap-2">
            <input
              id="ti-history-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => setHistoryFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="ti-history-upload" className="rounded-xl border px-3 py-2 cursor-pointer">
              Escolher historico
            </label>
            <span className="text-sm text-slate-500">{historyFile?.name || "Nenhum historico selecionado"}</span>
            <button type="button" onClick={importHistory} className="rounded-xl bg-slate-900 text-white px-4 py-2 font-semibold" disabled={importingHistory}>
              {importingHistory ? "Importando..." : "Importar Historico"}
            </button>
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
