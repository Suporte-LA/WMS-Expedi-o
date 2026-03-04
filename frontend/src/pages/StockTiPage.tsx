import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import type { TiStockMovement, TiStockProduct, User } from "../types";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";

const MOVEMENT_CODE_OPTIONS = [
  "B.U 1.1 RECEBIMENTO E ESTOQUE",
  "B.U 1.1/1.2/1.5 OPERACOES LOGISTICAS",
  "B.U 1.2 SEPARACAO/EMBARQUE/EMPACOTAMENTO",
  "B.U 1.3 EXPEDICAO",
  "B.U 1.3/1.4/1.5 OPERACOES LOGISTICAS",
  "B.U 1.4 MANUTENCAO E FROTA",
  "B.U 1.5 SEPARACAO/EMBARQUE/EMPACOTAMENTO",
  "B.U 2.1 ENTREGAS",
  "B.U 3.1 ADMINISTRATIVO DE VENDAS",
  "B.U 3.2 ADMINISTRATIVO DE VENDAS KEY ACCOUNT",
  "B.U 3.3 FINANCEIRO",
  "B.U 3.4 GENTE & CULTURA",
  "B.U 3.5 RELACOES EXTERNAS",
  "B.U 3.6 SUPORTE TECNICO",
  "B.U 4 PROMOTORES DE VENDAS",
  "CONSULTOR DE VENDAS",
  "DEP. ADMINISTRATIVO",
  "DEP. GERENCIA",
  "DEP. VENDAS",
  "PCP",
  "SAC",
  "ESTOQUE TI"
] as const;

type TiReport = {
  totals: {
    total_entry: number;
    total_exit: number;
    total_return: number;
  };
  topEntry: Array<{ sku: string; cod?: string; description?: string; category?: string; total_entry: number }>;
  leastEntry: Array<{ sku: string; cod?: string; description?: string; category?: string; total_entry: number }>;
  topExit: Array<{ sku: string; cod?: string; description?: string; category?: string; total_exit: number }>;
  leastExit: Array<{ sku: string; cod?: string; description?: string; category?: string; total_exit: number }>;
  byDestination: Array<{ destination: string; total_exit: number }>;
  flowByProduct: Array<{ sku: string; cod?: string; description?: string; category?: string; total_entry: number; total_exit: number; total_return: number }>;
  entryDetails: Array<{ id: string; created_at: string; created_by_name?: string; quantity: number; sku: string; cod?: string; description?: string; category?: string }>;
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function labelOf(item: { description?: string | null; category?: string | null; sku: string }) {
  return item.description || item.category || item.sku;
}

export function StockTiPage({ user }: { user: User }) {
  const [productRef, setProductRef] = useState("");
  const [selected, setSelected] = useState<TiStockProduct | null>(null);
  const [movementType, setMovementType] = useState<"entry" | "exit" | "return">("entry");
  const [quantity, setQuantity] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);

  const [movementDate, setMovementDate] = useState(isoToday());
  const [guide, setGuide] = useState("");
  const [movementCode, setMovementCode] = useState("");
  const [destinationFinal, setDestinationFinal] = useState("");

  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [reportFrom, setReportFrom] = useState(isoDaysAgo(30));
  const [reportTo, setReportTo] = useState(isoToday());
  const [report, setReport] = useState<TiReport | null>(null);
  const [activeView, setActiveView] = useState<"movement" | "report">("movement");

  const [products, setProducts] = useState<TiStockProduct[]>([]);
  const [movements, setMovements] = useState<TiStockMovement[]>([]);
  const [lowAlerts, setLowAlerts] = useState<TiStockProduct[]>([]);

  async function loadReport() {
    const { data } = await api.get(`/ti-stock/report?from=${reportFrom}&to=${reportTo}`);
    setReport(data);
  }

  async function loadData() {
    const [productsRes, movementsRes, alertsRes] = await Promise.all([
      api.get(`/ti-stock/products?page=1&pageSize=50${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`),
      api.get(`/ti-stock/movements?page=1&pageSize=30`),
      api.get("/ti-stock/alerts-low")
    ]);
    setProducts(productsRes.data.items || []);
    setMovements(movementsRes.data.items || []);
    setLowAlerts(alertsRes.data.items || []);
  }

  useEffect(() => {
    loadData();
    loadReport();
  }, []);

  async function lookupProduct(value: string) {
    const clean = value.trim();
    if (!clean) {
      setSelected(null);
      return;
    }
    try {
      const { data } = await api.get(`/ti-stock/lookup/${encodeURIComponent(clean)}`);
      setSelected(data);
    } catch {
      setSelected(null);
    }
  }

  async function onImportBase(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!baseFile) {
      setError("Selecione a base de produtos TI.");
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", baseFile);
      const { data } = await api.post("/ti-stock/import-base", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setMessage(
        `Base importada. Processadas: ${data.summary.processedRows}, Inseridas: ${data.summary.insertedRows}, Atualizadas: ${data.summary.updatedRows}`
      );
      setBaseFile(null);
      await loadData();
      await loadReport();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao importar base TI.");
    } finally {
      setImporting(false);
    }
  }

  async function onRegisterMovement(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!productRef.trim()) {
      setError("Bipe ou digite SKU/Cod.");
      return;
    }
    if (quantity === "" || Number(quantity) <= 0) {
      setError("Quantidade deve ser maior que zero.");
      return;
    }

    if (movementType === "exit") {
      if (!movementDate) {
        setError("Data obrigatoria para saida.");
        return;
      }
      if (!guide.trim()) {
        setError("Guia obrigatoria para saida.");
        return;
      }
      if (!movementCode) {
        setError("Movimentacao obrigatoria para saida.");
        return;
      }
      if (!destinationFinal.trim()) {
        setError("Destino final obrigatorio para saida.");
        return;
      }
    }

    setSavingMovement(true);
    try {
      await api.post("/ti-stock/movements", {
        productRef: productRef.trim(),
        movementType,
        quantity: Number(quantity),
        notes: notes.trim() || undefined,
        movementDate: movementType === "exit" ? movementDate : undefined,
        guide: movementType === "exit" ? guide.trim() : undefined,
        movementCode: movementType === "exit" ? movementCode : undefined,
        destinationFinal: movementType === "exit" ? destinationFinal.trim() : undefined
      });
      setMessage("Movimento registrado com sucesso.");
      setQuantity("");
      setNotes("");
      setGuide("");
      setMovementCode("");
      setDestinationFinal("");
      setMovementDate(isoToday());
      await lookupProduct(productRef);
      await loadData();
      await loadReport();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar movimento.");
    } finally {
      setSavingMovement(false);
    }
  }

  const destinationChart = (report?.byDestination || []).map((item) => ({
    destino: item.destination,
    saida: Number(item.total_exit || 0)
  }));

  const movementTypeLabel: Record<"entry" | "exit" | "return", string> = {
    entry: "Entrada",
    exit: "Saida",
    return: "Devolucao"
  };

  return (
    <>
      <section className="space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
          <h2 className="font-semibold">Estoque TI</h2>
          <p className="text-sm text-slate-600">
            Entrada/Devolucao simples e Saida com formulario completo: ID, Data, Cod, Guia, Saida, Movimentacao e Destino final.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setActiveView("movement")}
              className={`rounded-lg px-3 py-1 text-sm ${activeView === "movement" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Movimentacao
            </button>
            <button
              type="button"
              onClick={() => setActiveView("report")}
              className={`rounded-lg px-3 py-1 text-sm ${activeView === "report" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Relatorio de Movimentacao
            </button>
          </div>
        </div>

        {activeView === "movement" && (
        <form onSubmit={onImportBase} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="font-semibold">Configuracao da Base (QR/SKU)</h3>
          <p className="text-sm text-slate-600">
            Envie a planilha com colunas: SKU, Cod, Categoria, Guias, Entrada, Saida, Devolucao, Estoque Final, Estoque Minimo.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="ti-base"
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setBaseFile(e.target.files?.[0] || null)}
            />
            <label htmlFor="ti-base" className="rounded-xl border px-3 py-2 cursor-pointer">
              Escolher base TI
            </label>
            <span className="text-sm text-slate-500">{baseFile?.name || "Nenhum arquivo selecionado"}</span>
            <button type="submit" disabled={importing} className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold disabled:opacity-50">
              {importing ? "Importando..." : "Importar Base TI"}
            </button>
          </div>
        </form>
        )}

        {activeView === "movement" && (
        <form onSubmit={onRegisterMovement} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="font-semibold">Movimentacao de Materiais</h3>
          <div className="grid md:grid-cols-12 gap-3">
            <div className="md:col-span-4 flex gap-2">
              <input
                className="border rounded-xl px-3 py-2 flex-1"
                placeholder="SKU ou Cod (bipado)"
                value={productRef}
                onChange={(e) => setProductRef(e.target.value)}
                onBlur={() => lookupProduct(productRef)}
              />
              <button type="button" className="rounded-xl border px-3" onClick={() => setScannerOpen(true)}>
                Escanear
              </button>
            </div>
            <div className="md:col-span-3 grid grid-cols-3 gap-1 rounded-xl border p-1">
              {(["entry", "exit", "return"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMovementType(type)}
                  className={`rounded-lg px-2 py-1 text-sm ${movementType === type ? "bg-slate-900 text-white" : "bg-white"}`}
                >
                  {movementTypeLabel[type]}
                </button>
              ))}
            </div>
            <input
              className="border rounded-xl px-3 py-2 md:col-span-1"
              type="number"
              min={0}
              step="0.01"
              placeholder={movementType === "exit" ? "Saida" : "Quantidade"}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))}
            />
            <input
              className="border rounded-xl px-3 py-2 md:col-span-3"
              placeholder="Observacao (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button type="submit" disabled={savingMovement} className="rounded-xl bg-slate-900 text-white px-3 py-2 font-semibold md:col-span-1 disabled:opacity-50">
              {savingMovement ? "..." : "Lancar"}
            </button>
          </div>

          {movementType === "exit" && (
            <div className="grid md:grid-cols-6 gap-3">
              <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="ID" value="Gerado automaticamente" readOnly />
              <input className="border rounded-xl px-3 py-2" type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
              <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Cod" value={selected?.cod || ""} readOnly />
              <input className="border rounded-xl px-3 py-2" placeholder="Guia" value={guide} onChange={(e) => setGuide(e.target.value)} />
              <select className="border rounded-xl px-3 py-2" value={movementCode} onChange={(e) => setMovementCode(e.target.value)}>
                <option value="">Movimentacao</option>
                {MOVEMENT_CODE_OPTIONS.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              <input className="border rounded-xl px-3 py-2" placeholder="Destino final" value={destinationFinal} onChange={(e) => setDestinationFinal(e.target.value)} />
            </div>
          )}

          <div className="grid md:grid-cols-6 gap-3">
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="SKU" value={selected?.sku || ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Cod" value={selected?.cod || ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Descricao" value={selected?.description || ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Categoria" value={selected?.category || ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Estoque Atual" value={selected?.current_stock ?? ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Estoque Minimo" value={selected?.min_stock ?? ""} readOnly />
          </div>
          <p className="text-xs text-slate-500">Usuario logado: {user.name}</p>
        </form>
        )}

        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {activeView === "report" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-semibold">Relatorio Estoque TI</h3>
            <div className="flex items-center gap-2">
              <input className="border rounded-lg px-3 py-1 text-sm" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
              <input className="border rounded-lg px-3 py-1 text-sm" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
              <button type="button" className="rounded-lg border px-3 py-1 text-sm" onClick={loadReport}>Atualizar</button>
            </div>
          </div>

          {report && (
            <>
              <div className="grid md:grid-cols-4 gap-3">
                <article className="rounded-xl border p-3"><p className="text-xs text-slate-500">Total Entrada</p><p className="text-2xl font-bold">{Number(report.totals.total_entry || 0)}</p></article>
                <article className="rounded-xl border p-3"><p className="text-xs text-slate-500">Total Saida</p><p className="text-2xl font-bold">{Number(report.totals.total_exit || 0)}</p></article>
                <article className="rounded-xl border p-3"><p className="text-xs text-slate-500">Total Devolucao</p><p className="text-2xl font-bold">{Number(report.totals.total_return || 0)}</p></article>
                <article className="rounded-xl border p-3"><p className="text-xs text-slate-500">Saldo Movimentado</p><p className="text-2xl font-bold">{Number(report.totals.total_entry || 0) + Number(report.totals.total_return || 0) - Number(report.totals.total_exit || 0)}</p></article>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl border p-3 overflow-auto">
                  <h4 className="font-semibold mb-2">Maior entrada (quais itens entraram mais)</h4>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b"><th className="py-1">Item</th><th>Entrada</th></tr></thead>
                    <tbody>
                      {(report.topEntry || []).map((row) => (
                        <tr key={`${row.sku}-${row.cod}`} className="border-b"><td className="py-1">{labelOf({ description: row.description, category: row.category, sku: row.sku })}</td><td>{Number(row.total_entry)}</td></tr>
                      ))}
                      {!report.topEntry?.length && (
                        <tr><td className="py-2 text-slate-500" colSpan={2}>Sem entradas no periodo.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border p-3 overflow-auto">
                  <h4 className="font-semibold mb-2">Menor entrada (quais itens entraram menos)</h4>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b"><th className="py-1">Item</th><th>Entrada</th></tr></thead>
                    <tbody>
                      {(report.leastEntry || []).map((row) => (
                        <tr key={`${row.sku}-${row.cod}`} className="border-b"><td className="py-1">{labelOf({ description: row.description, category: row.category, sku: row.sku })}</td><td>{Number(row.total_entry)}</td></tr>
                      ))}
                      {!report.leastEntry?.length && (
                        <tr><td className="py-2 text-slate-500" colSpan={2}>Sem entradas no periodo.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border p-3 overflow-auto">
                  <h4 className="font-semibold mb-2">Maior vazao (quem mais sai)</h4>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b"><th className="py-1">Item</th><th>Saida</th></tr></thead>
                    <tbody>
                      {(report.topExit || []).map((row) => (
                        <tr key={`${row.sku}-${row.cod}`} className="border-b"><td className="py-1">{labelOf({ description: row.description, category: row.category, sku: row.sku })}</td><td>{Number(row.total_exit)}</td></tr>
                      ))}
                      {!report.topExit?.length && (
                        <tr><td className="py-2 text-slate-500" colSpan={2}>Sem saidas no periodo.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl border p-3 overflow-auto">
                  <h4 className="font-semibold mb-2">Menor vazao (quem menos sai)</h4>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b"><th className="py-1">Item</th><th>Saida</th></tr></thead>
                    <tbody>
                      {(report.leastExit || []).map((row) => (
                        <tr key={`${row.sku}-${row.cod}`} className="border-b"><td className="py-1">{labelOf({ description: row.description, category: row.category, sku: row.sku })}</td><td>{Number(row.total_exit)}</td></tr>
                      ))}
                      {!report.leastExit?.length && (
                        <tr><td className="py-2 text-slate-500" colSpan={2}>Sem saidas no periodo.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border p-3 overflow-auto">
                <h4 className="font-semibold mb-2">Entradas no periodo (detalhado)</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-1">Data/Hora</th>
                      <th>SKU</th>
                      <th>Cod</th>
                      <th>Descricao</th>
                      <th>Qtd</th>
                      <th>Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.entryDetails || []).map((row) => (
                      <tr key={row.id} className="border-b">
                        <td className="py-1">{new Date(row.created_at).toLocaleString("pt-BR")}</td>
                        <td>{row.sku}</td>
                        <td>{row.cod || "-"}</td>
                        <td>{row.description || row.category || "-"}</td>
                        <td>{Number(row.quantity)}</td>
                        <td>{row.created_by_name || "-"}</td>
                      </tr>
                    ))}
                    {!report.entryDetails?.length && (
                      <tr><td className="py-2 text-slate-500" colSpan={6}>Sem entradas no periodo.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border p-3">
                <h4 className="font-semibold mb-2">Destino com maior saida de material</h4>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={destinationChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="destino" hide />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="saida" name="Saida" fill="#0f766e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {activeView === "movement" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Avisos de Estoque Baixo</h3>
            <button type="button" className="rounded-lg border px-3 py-1 text-sm" onClick={loadData}>
              Atualizar
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">SKU</th>
                <th>Cod</th>
                <th>Descricao</th>
                <th>Categoria</th>
                <th>Atual</th>
                <th>Minimo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lowAlerts.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{item.sku}</td>
                  <td>{item.cod || "-"}</td>
                  <td>{item.display_name || item.description || item.category || "-"}</td>
                  <td>{item.category || "-"}</td>
                  <td>{item.current_stock}</td>
                  <td>{item.min_stock}</td>
                  <td className="text-red-700 font-semibold">Baixo</td>
                </tr>
              ))}
              {!lowAlerts.length && (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={7}>
                    Nenhum item abaixo do estoque minimo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {activeView === "movement" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Base de Produtos TI</h3>
            <input
              className="border rounded-lg px-3 py-1 text-sm"
              placeholder="Buscar SKU/Cod/Descricao/Categoria"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={loadData}
            />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">SKU</th>
                <th>Cod</th>
                <th>Descricao</th>
                <th>Categoria</th>
                <th>Guias</th>
                <th>Atual</th>
                <th>Minimo</th>
              </tr>
            </thead>
            <tbody>
              {products.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{item.sku}</td>
                  <td>{item.cod || "-"}</td>
                  <td>{item.description || "-"}</td>
                  <td>{item.category || "-"}</td>
                  <td>{item.guides || "-"}</td>
                  <td>{item.current_stock}</td>
                  <td>{item.min_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        {activeView === "movement" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
          <h3 className="font-semibold mb-3">Ultimas Movimentacoes</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">ID</th>
                <th>Data/Hora</th>
                <th>Tipo</th>
                <th>Data Saida</th>
                <th>SKU</th>
                <th>Cod</th>
                <th>Descricao</th>
                <th>Guia</th>
                <th>Movimentacao</th>
                <th>Destino final</th>
                <th>Qtd</th>
                <th>Antes</th>
                <th>Depois</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="py-2">{m.id.slice(0, 8)}</td>
                  <td>{new Date(m.created_at).toLocaleString("pt-BR")}</td>
                  <td>{movementTypeLabel[m.movement_type]}</td>
                  <td>{m.movement_date || "-"}</td>
                  <td>{m.sku || "-"}</td>
                  <td>{m.cod || "-"}</td>
                  <td>{m.description || m.category || "-"}</td>
                  <td>{m.guide || "-"}</td>
                  <td>{m.movement_code || "-"}</td>
                  <td>{m.destination_final || "-"}</td>
                  <td>{m.quantity}</td>
                  <td>{m.stock_before}</td>
                  <td>{m.stock_after}</td>
                  <td>{m.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(value) => {
          setProductRef(value);
          lookupProduct(value);
        }}
      />
    </>
  );
}
