import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { getStoredUser } from "../lib/auth";
import { api } from "../lib/api";
import type {
  StockActivityLog,
  StockAllocationLog,
  StockAllocationRecord,
  StockBaseImport,
  StockBaseProduct,
  StockDashboardResponse,
  StockExpirationRecord,
  StockReplenishmentRecord
} from "../types";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function currentTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

type StockTab = "dashboard" | "localizar" | "base" | "abastecimento" | "validades" | "alocacao";
type ScannerTarget = "localizar" | "abastecimento" | "validades" | "alocacao" | null;

type LookupPayload = {
  product: StockBaseProduct;
  expirationContext?: {
    local?: string | null;
    street?: string | null;
    expiries?: Array<{
      quantity?: number | null;
      expiry_date?: string | null;
    }>;
  };
  allocations?: StockAllocationRecord[];
};

const EMPTY_REPLENISHMENT = {
  scannedCode: "",
  workDate: isoToday(),
  entryTime: currentTime(),
  quantity1: "",
  expiry1: "",
  quantity2: "",
  expiry2: ""
};

const EMPTY_EXPIRATION = {
  scannedCode: "",
  workDate: isoToday(),
  quantity: "",
  expiryDate: "",
  local: "",
  street: ""
};

const EMPTY_ALLOCATION = {
  scannedCode: "",
  quantity: "1",
  shed: "",
  street: "",
  building: "",
  apartment: "",
  palletPosition: "",
  palletCode: "",
  notes: ""
};

function sectionButtonClass(active: boolean) {
  return `workspace-nav-button ${active ? "workspace-nav-button-active" : "workspace-nav-button-idle"}`;
}

function softButtonClass(extra = "") {
  return `workspace-soft-button ${extra}`.trim();
}

function primaryButtonClass(extra = "") {
  return `workspace-primary-button ${extra}`.trim();
}

export function StockPage() {
  const storedUser = getStoredUser();
  const [activeTab, setActiveTab] = useState<StockTab>("dashboard");
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>(null);

  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [baseFileBuffer, setBaseFileBuffer] = useState<ArrayBuffer | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [supplierFilter, setSupplierFilter] = useState("");
  const [streetFilter, setStreetFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [scanValue, setScanValue] = useState("");

  const [products, setProducts] = useState<StockBaseProduct[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [imports, setImports] = useState<StockBaseImport[]>([]);
  const [locatedItem, setLocatedItem] = useState<StockBaseProduct | null>(null);
  const [dashboardFrom, setDashboardFrom] = useState(isoDaysAgo(30));
  const [dashboardTo, setDashboardTo] = useState(isoToday());
  const [dashboard, setDashboard] = useState<StockDashboardResponse | null>(null);
  const [activityLogs, setActivityLogs] = useState<StockActivityLog[]>([]);
  const [activityOperator, setActivityOperator] = useState("");
  const [activityType, setActivityType] = useState("");
  const [activitySearch, setActivitySearch] = useState("");

  const [replenishmentForm, setReplenishmentForm] = useState(EMPTY_REPLENISHMENT);
  const [replenishmentProduct, setReplenishmentProduct] = useState<StockBaseProduct | null>(null);
  const [replenishmentContext, setReplenishmentContext] = useState<{ local?: string | null; street?: string | null } | null>(null);
  const [savingReplenishment, setSavingReplenishment] = useState(false);
  const [replenishmentFrom, setReplenishmentFrom] = useState(isoDaysAgo(30));
  const [replenishmentTo, setReplenishmentTo] = useState(isoToday());
  const [replenishmentSearch, setReplenishmentSearch] = useState("");
  const [replenishments, setReplenishments] = useState<StockReplenishmentRecord[]>([]);

  const [expirationForm, setExpirationForm] = useState(EMPTY_EXPIRATION);
  const [expirationProduct, setExpirationProduct] = useState<StockBaseProduct | null>(null);
  const [savingExpiration, setSavingExpiration] = useState(false);
  const [expirationFrom, setExpirationFrom] = useState(isoDaysAgo(30));
  const [expirationTo, setExpirationTo] = useState(isoToday());
  const [expirationSearch, setExpirationSearch] = useState("");
  const [expirations, setExpirations] = useState<StockExpirationRecord[]>([]);
  const [locatedAllocations, setLocatedAllocations] = useState<StockAllocationRecord[]>([]);

  const [allocationMode, setAllocationMode] = useState<"single" | "pallet">("single");
  const [allocationForm, setAllocationForm] = useState(EMPTY_ALLOCATION);
  const [allocationProduct, setAllocationProduct] = useState<StockBaseProduct | null>(null);
  const [allocationItems, setAllocationItems] = useState<Array<{ productCode: string; description: string; quantity: string }>>([]);
  const [allocations, setAllocations] = useState<StockAllocationRecord[]>([]);
  const [allocationLogs, setAllocationLogs] = useState<StockAllocationLog[]>([]);
  const [allocationSearch, setAllocationSearch] = useState("");
  const [allocationPalletSearch, setAllocationPalletSearch] = useState("");
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [editingAllocationId, setEditingAllocationId] = useState<string | null>(null);

  const periodLabel = useMemo(() => `${isoDaysAgo(30)} ate ${isoToday()}`, []);

  async function loadBase() {
    const params = new URLSearchParams({ page: "1", pageSize: "200" });
    if (supplierFilter.trim()) params.set("supplier", supplierFilter.trim());
    if (streetFilter.trim()) params.set("street", streetFilter.trim());
    if (searchFilter.trim()) params.set("search", searchFilter.trim());

    const [baseRes, importsRes] = await Promise.all([api.get(`/stock/base?${params.toString()}`), api.get("/stock/imports")]);

    setProducts(baseRes.data.items || []);
    setSuppliers(baseRes.data.suppliers || []);
    setImports(importsRes.data.items || []);
  }

  async function loadDashboard() {
    const params = new URLSearchParams({ from: dashboardFrom, to: dashboardTo });
    const [dashRes, logsRes] = await Promise.all([
      api.get<StockDashboardResponse>(`/stock/dashboard?${params.toString()}`),
      api.get(`/stock/activity?${params.toString()}&page=1&pageSize=100`)
    ]);
    setDashboard(dashRes.data);
    setActivityLogs(logsRes.data.items || []);
  }

  async function loadActivityLogs() {
    const params = new URLSearchParams({
      from: dashboardFrom,
      to: dashboardTo,
      page: "1",
      pageSize: "100"
    });
    if (activityOperator.trim()) params.set("operator", activityOperator.trim());
    if (activityType) params.set("activity", activityType);
    if (activitySearch.trim()) params.set("search", activitySearch.trim());
    const { data } = await api.get(`/stock/activity?${params.toString()}`);
    setActivityLogs(data.items || []);
  }

  async function loadReplenishments() {
    const params = new URLSearchParams({
      from: replenishmentFrom,
      to: replenishmentTo,
      page: "1",
      pageSize: "100"
    });
    if (replenishmentSearch.trim()) params.set("search", replenishmentSearch.trim());
    const { data } = await api.get(`/stock/replenishments?${params.toString()}`);
    setReplenishments(data.items || []);
  }

  async function loadExpirations() {
    const params = new URLSearchParams({
      from: expirationFrom,
      to: expirationTo,
      page: "1",
      pageSize: "100"
    });
    if (expirationSearch.trim()) params.set("search", expirationSearch.trim());
    const { data } = await api.get(`/stock/expirations?${params.toString()}`);
    setExpirations(data.items || []);
  }

  async function loadAllocations() {
    const params = new URLSearchParams({ page: "1", pageSize: "100" });
    if (allocationSearch.trim()) params.set("search", allocationSearch.trim());
    if (allocationPalletSearch.trim()) params.set("palletCode", allocationPalletSearch.trim());
    const { data } = await api.get(`/stock/allocations?${params.toString()}`);
    setAllocations(data.items || []);
    setAllocationLogs(data.logs || []);
  }

  useEffect(() => {
    Promise.all([loadBase(), loadReplenishments(), loadExpirations(), loadDashboard(), loadAllocations()]).catch(() => {
      setProducts([]);
      setSuppliers([]);
      setImports([]);
      setReplenishments([]);
      setExpirations([]);
      setDashboard(null);
      setActivityLogs([]);
      setAllocations([]);
      setAllocationLogs([]);
    });
  }, []);

  async function resolveProduct(ref: string, target: "locate" | "abastecimento" | "validades" | "alocacao") {
    const clean = ref.trim();
    if (!clean) {
      setError("Bipe ou digite um codigo valido.");
      return;
    }

    setError("");
    setMessage("");
    try {
      const { data } = await api.get<LookupPayload>(`/stock/lookup/${encodeURIComponent(clean)}`);
      const product = data.product;
      const expirationContext = data.expirationContext || {};
      if (target === "locate") {
        setLocatedItem(product);
        setLocatedAllocations(data.allocations || []);
        setScanValue(clean);
      }
      if (target === "abastecimento") {
        setReplenishmentProduct(product);
        setReplenishmentContext({
          local: expirationContext.local || null,
          street: expirationContext.street || null
        });
        setReplenishmentForm((prev) => ({
          ...prev,
          scannedCode: clean,
          expiry1: expirationContext.expiries?.[0]?.expiry_date || prev.expiry1,
          expiry2: expirationContext.expiries?.[1]?.expiry_date || prev.expiry2
        }));
      }
      if (target === "validades") {
        setExpirationProduct(product);
        setExpirationForm((prev) => ({ ...prev, scannedCode: clean }));
      }
      if (target === "alocacao") {
        setAllocationProduct(product);
        setAllocationForm((prev) => ({ ...prev, scannedCode: clean }));
      }
    } catch (err: any) {
      if (target === "locate") {
        setLocatedItem(null);
        setLocatedAllocations([]);
      }
      if (target === "abastecimento") {
        setReplenishmentProduct(null);
        setReplenishmentContext(null);
      }
      if (target === "validades") setExpirationProduct(null);
      if (target === "alocacao") setAllocationProduct(null);
      setError(err?.response?.data?.message || "Produto nao encontrado na base do estoque.");
    }
  }

  async function onImportBase(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!baseFile || !baseFileBuffer) {
      setError("Selecione a base do estoque.");
      return;
    }

    setImporting(true);
    try {
      const form = new FormData();
      const snapshot = new File([baseFileBuffer], baseFile.name, {
        type: baseFile.type || "application/octet-stream",
        lastModified: Date.now()
      });
      form.append("file", snapshot);
      const { data } = await api.post("/stock/import-base", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setMessage(
        `Base importada. Processadas: ${data.summary.processedRows}, Inseridas: ${data.summary.insertedRows}, Atualizadas: ${data.summary.updatedRows}`
      );
      setBaseFile(null);
      setBaseFileBuffer(null);
      await loadBase();
    } catch (err: any) {
      if (err?.message?.includes("ERR_UPLOAD_FILE_CHANGED")) {
        setError("O arquivo foi alterado depois da selecao. Escolha a planilha novamente e envie.");
      } else {
        setError(err?.response?.data?.message || "Falha ao importar base do estoque.");
      }
    } finally {
      setImporting(false);
    }
  }

  async function onFilterBase(e: FormEvent) {
    e.preventDefault();
    setLocatedItem(null);
    setError("");
    await loadBase().catch((err: any) => {
      setError(err?.response?.data?.message || "Falha ao carregar base do estoque.");
    });
  }

  async function onSubmitReplenishment(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSavingReplenishment(true);
    try {
      await api.post("/stock/replenishments", {
        scannedCode: replenishmentForm.scannedCode,
        workDate: replenishmentForm.workDate,
        entryTime: replenishmentForm.entryTime,
        quantity1: replenishmentForm.quantity1,
        expiry1: replenishmentForm.expiry1,
        quantity2: replenishmentForm.quantity2 || undefined,
        expiry2: replenishmentForm.expiry2 || undefined
      });
      setMessage("Abastecimento registrado.");
      setReplenishmentForm({ ...EMPTY_REPLENISHMENT, workDate: isoToday(), entryTime: currentTime() });
      setReplenishmentProduct(null);
      setReplenishmentContext(null);
      await Promise.all([loadReplenishments(), loadDashboard()]);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar abastecimento.");
    } finally {
      setSavingReplenishment(false);
    }
  }

  async function onSubmitExpiration(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSavingExpiration(true);
    try {
      await api.post("/stock/expirations", {
        scannedCode: expirationForm.scannedCode,
        workDate: expirationForm.workDate,
        quantity: expirationForm.quantity,
        expiryDate: expirationForm.expiryDate,
        local: expirationForm.local,
        street: expirationForm.street
      });
      setMessage("Validade registrada.");
      setExpirationForm({ ...EMPTY_EXPIRATION, workDate: isoToday() });
      setExpirationProduct(null);
      await Promise.all([loadExpirations(), loadDashboard()]);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar validade.");
    } finally {
      setSavingExpiration(false);
    }
  }

  function resetAllocationForm() {
    setAllocationForm(EMPTY_ALLOCATION);
    setAllocationProduct(null);
    setAllocationItems([]);
    setEditingAllocationId(null);
    setAllocationMode("single");
  }

  function addAllocationItem() {
    if (!allocationProduct) {
      setError("Selecione ou bipe um produto antes de adicionar ao pallet.");
      return;
    }
    const quantity = Number(allocationForm.quantity || 0);
    if (!quantity || quantity <= 0) {
      setError("Quantidade da alocacao deve ser maior que zero.");
      return;
    }
    setAllocationItems((prev) => [
      ...prev,
      {
        productCode: allocationProduct.product_code,
        description: allocationProduct.description,
        quantity: String(quantity)
      }
    ]);
    setAllocationForm((prev) => ({ ...prev, scannedCode: "", quantity: "1" }));
    setAllocationProduct(null);
  }

  function editAllocationRow(row: StockAllocationRecord) {
    setActiveTab("alocacao");
    setEditingAllocationId(row.id);
    setAllocationMode(row.allocation_mode);
    setAllocationProduct({
      id: row.id,
      product_code: row.product_code,
      description: row.description,
      barcode: row.barcode,
      supplier_code: row.supplier_code,
      supplier_name: row.supplier_name,
      local: null,
      street: null,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
    setAllocationItems([]);
    setAllocationForm({
      scannedCode: row.product_code,
      quantity: String(Number(row.quantity || 0)),
      shed: row.shed,
      street: row.street,
      building: row.building,
      apartment: row.apartment,
      palletPosition: row.pallet_position,
      palletCode: row.pallet_code || "",
      notes: row.notes || ""
    });
  }

  async function submitAllocation(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    const items =
      allocationMode === "pallet"
        ? allocationItems.map((item) => ({
            productCode: item.productCode,
            quantity: Number(item.quantity || 0)
          }))
        : allocationProduct
          ? [{ productCode: allocationProduct.product_code, quantity: Number(allocationForm.quantity || 0) }]
          : [];

    if (!items.length) {
      setError("Selecione pelo menos um produto para alocar.");
      return;
    }

    setSavingAllocation(true);
    try {
      const payload = {
        mode: allocationMode,
        items,
        shed: allocationForm.shed,
        street: allocationForm.street,
        building: allocationForm.building,
        apartment: allocationForm.apartment,
        palletPosition: allocationForm.palletPosition,
        palletCode: allocationForm.palletCode || undefined,
        notes: allocationForm.notes || undefined
      };

      if (editingAllocationId) {
        await api.patch(`/stock/allocations/${editingAllocationId}`, payload);
        setMessage("Alocacao atualizada.");
      } else {
        await api.post("/stock/allocations", payload);
        setMessage(allocationMode === "pallet" ? "Pallet alocado." : "Produto alocado.");
      }

      resetAllocationForm();
      await Promise.all([loadAllocations(), loadBase()]);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao salvar alocacao.");
    } finally {
      setSavingAllocation(false);
    }
  }

  return (
    <>
      <section className="workspace-shell">
        <div className="workspace-panel space-y-4">
          <div className="workspace-panel-header">
            <div>
              <h2 className="workspace-title">Estoque</h2>
              <p className="workspace-copy">
              Base propria para abastecimento, validades e localizacao. Nao tem relacao com os imports da Expedicao.
              </p>
            </div>
            <div className="workspace-nav">
              <button type="button" className={sectionButtonClass(activeTab === "dashboard")} onClick={() => setActiveTab("dashboard")}>
                Dashboard
              </button>
              <button type="button" className={sectionButtonClass(activeTab === "localizar")} onClick={() => setActiveTab("localizar")}>
                Localizar
              </button>
              <button type="button" className={sectionButtonClass(activeTab === "base")} onClick={() => setActiveTab("base")}>
                Base
              </button>
              <button type="button" className={sectionButtonClass(activeTab === "abastecimento")} onClick={() => setActiveTab("abastecimento")}>
                Abastecimento
              </button>
              <button type="button" className={sectionButtonClass(activeTab === "validades")} onClick={() => setActiveTab("validades")}>
                Validades
              </button>
              <button type="button" className={sectionButtonClass(activeTab === "alocacao")} onClick={() => setActiveTab("alocacao")}>
                Alocacao
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <article className="workspace-kpi-card">
              <p className="text-sm text-slate-500">Periodo padrao</p>
              <p className="text-lg font-semibold">{periodLabel}</p>
            </article>
            <article className="workspace-kpi-card">
              <p className="text-sm text-slate-500">Produtos na base</p>
              <p className="text-lg font-semibold">{products.length}</p>
            </article>
            <article className="workspace-kpi-card">
              <p className="text-sm text-slate-500">Abastecimentos</p>
              <p className="text-lg font-semibold">{replenishments.length}</p>
            </article>
            <article className="workspace-kpi-card">
              <p className="text-sm text-slate-500">Validades</p>
              <p className="text-lg font-semibold">{expirations.length}</p>
            </article>
          </div>
        </div>

        <div className="workspace-panel space-y-4">
          {activeTab === "dashboard" && (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadDashboard().catch(() => setError("Falha ao carregar dashboard do estoque."));
                }}
                className="grid md:grid-cols-4 gap-3"
              >
                <input className="border rounded-xl px-3 py-2" type="date" value={dashboardFrom} onChange={(e) => setDashboardFrom(e.target.value)} />
                <input className="border rounded-xl px-3 py-2" type="date" value={dashboardTo} onChange={(e) => setDashboardTo(e.target.value)} />
                <div className="rounded-xl border px-3 py-2 bg-slate-50 text-sm text-slate-600 flex items-center">
                  Entradas e saídas por validade/abastecimento
                </div>
                <button className={primaryButtonClass("px-5")}>Atualizar dashboard</button>
              </form>

              <div className="grid md:grid-cols-4 gap-3">
                <article className="workspace-kpi-card">
                  <p className="text-sm text-slate-500">Total Entradas</p>
                  <p className="text-lg font-semibold">{Number(dashboard?.cards.total_entries || 0).toFixed(2)}</p>
                </article>
                <article className="workspace-kpi-card">
                  <p className="text-sm text-slate-500">Total Saidas</p>
                  <p className="text-lg font-semibold">{Number(dashboard?.cards.total_exits || 0).toFixed(2)}</p>
                </article>
                <article className="workspace-kpi-card">
                  <p className="text-sm text-slate-500">SKUs Movimentados</p>
                  <p className="text-lg font-semibold">{dashboard?.cards.total_skus || 0}</p>
                </article>
                <article className="workspace-kpi-card">
                  <p className="text-sm text-slate-500">Operadores Ativos</p>
                  <p className="text-lg font-semibold">{dashboard?.cards.total_operators || 0}</p>
                </article>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div className="workspace-kpi-card h-72">
                  <h3 className="font-semibold mb-2">Tendencia diaria</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dashboard?.trend || []}>
                      <XAxis dataKey="work_date" />
                      <YAxis />
                      <Tooltip />
                      <Line dataKey="entries" stroke="#0f766e" name="Entradas" />
                      <Line dataKey="exits" stroke="#dc2626" name="Saidas" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="workspace-kpi-card h-72">
                  <h3 className="font-semibold mb-2">Operadores e atividades</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dashboard?.byOperator || []}>
                      <XAxis dataKey="operator_name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="total_quantity" fill="#0f766e" name="Quantidade" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="workspace-kpi-card space-y-3">
                <div className="grid md:grid-cols-4 gap-3">
                  <input className="border rounded-xl px-3 py-2" placeholder="Operador" value={activityOperator} onChange={(e) => setActivityOperator(e.target.value)} />
                  <select className="border rounded-xl px-3 py-2" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
                    <option value="">Todas as atividades</option>
                    <option value="validade">Entrada por Validade</option>
                    <option value="abastecimento">Saida por Abastecimento</option>
                  </select>
                  <input className="border rounded-xl px-3 py-2" placeholder="Produto / sku / local / rua" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} />
                  <button type="button" className={softButtonClass()} onClick={() => loadActivityLogs().catch(() => setError("Falha ao carregar log do estoque."))}>
                    Filtrar log
                  </button>
                </div>

                <div className="overflow-auto">
                  <table className="workspace-table">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Data</th>
                        <th>Tipo</th>
                        <th>Atividade</th>
                        <th>Produto</th>
                        <th>Descricao</th>
                        <th>SKU</th>
                        <th>Local</th>
                        <th>Rua</th>
                        <th>Validade</th>
                        <th>Quantidade</th>
                        <th>Operador</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="py-2">{item.work_date ? new Date(`${item.work_date}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.movement_type === "entry" ? "Entrada" : "Saida"}</td>
                          <td>{item.activity_type === "validade" ? "Validade" : "Abastecimento"}</td>
                          <td>{item.product_code}</td>
                          <td>{item.description}</td>
                          <td>{item.barcode || "-"}</td>
                          <td>{item.local || "-"}</td>
                          <td>{item.street || "-"}</td>
                          <td>{item.expiry_date ? new Date(`${item.expiry_date}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{Number(item.quantity || 0).toFixed(2)}</td>
                          <td>{item.operator_name || "-"}</td>
                        </tr>
                      ))}
                      {!activityLogs.length && (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan={11}>Nenhuma movimentacao encontrada no periodo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "localizar" && (
            <div className="space-y-4">
              <form onSubmit={onFilterBase} className="grid md:grid-cols-6 gap-3">
                <select className="border rounded-xl px-3 py-2" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                  <option value="">Todos os fornecedores</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier} value={supplier}>{supplier}</option>
                  ))}
                </select>
                <input
                  className="border rounded-xl px-3 py-2"
                  placeholder="Filtrar por rua"
                  value={streetFilter}
                  onChange={(e) => setStreetFilter(e.target.value)}
                />
                <input
                  className="border rounded-xl px-3 py-2"
                  placeholder="Fornecedor / produto / cod produto / cod barras"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                <div className="md:col-span-2 flex gap-2">
                  <input
                    className="border rounded-xl px-3 py-2 flex-1"
                    placeholder="Bipar caixa / codigo de barras"
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                  />
                  <button type="button" className={softButtonClass()} onClick={() => setScannerTarget("localizar")}>
                    Escanear
                  </button>
                  <button type="button" className={softButtonClass()} onClick={() => resolveProduct(scanValue, "locate")}>
                    Localizar
                  </button>
                </div>
                <button type="submit" className={primaryButtonClass("px-5")}>
                  Filtrar base
                </button>
              </form>

              {locatedItem && (
                <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4">
                  <p className="text-sm text-slate-500 mb-1">Posicao encontrada</p>
                  <p className="text-xl font-bold">{locatedItem.description}</p>
                  <div className="grid md:grid-cols-4 gap-3 mt-3 text-sm">
                    <div><span className="text-slate-500">Cod Produto:</span> {locatedItem.product_code}</div>
                    <div><span className="text-slate-500">Codigo Barras:</span> {locatedItem.barcode || "-"}</div>
                    <div><span className="text-slate-500">Fornecedor:</span> {locatedItem.supplier_name || "-"}</div>
                    <div>
                      <span className="text-slate-500">Posicao atual:</span>{" "}
                      {locatedItem.allocation_position_code || `${locatedItem.local || "-"} ${locatedItem.street || ""}`.trim()}
                    </div>
                  </div>
                </div>
              )}

              {Boolean(locatedAllocations.length) && (
                <div className="workspace-kpi-card overflow-auto">
                  <h3 className="font-semibold mb-3">Alocacoes atuais do produto</h3>
                  <table className="workspace-table">
                    <thead>
                      <tr>
                        <th className="py-2">Posicao</th>
                        <th>Pallet</th>
                        <th>Qtd</th>
                        <th>Modo</th>
                        <th>Operador</th>
                        <th>Atualizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locatedAllocations.map((allocation) => (
                        <tr key={allocation.id}>
                          <td className="py-2">{allocation.position_code} - {allocation.position_label}</td>
                          <td>{allocation.pallet_code || "-"}</td>
                          <td>{Number(allocation.quantity)}</td>
                          <td>{allocation.allocation_mode === "pallet" ? "Pallet completo" : "Produto"}</td>
                          <td>{allocation.operator_name}</td>
                          <td>{new Date(allocation.updated_at).toLocaleString("pt-BR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="overflow-auto">
                <table className="workspace-table">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Cod Produto</th>
                      <th>Descricao</th>
                      <th>Codigo Barras</th>
                      <th>Cod Forn.</th>
                      <th>Fornecedor</th>
                      <th>Local</th>
                      <th>Rua</th>
                      <th>Alocacao Atual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((item) => (
                      <tr key={item.id} className={`border-b ${locatedItem?.id === item.id ? "bg-teal-50" : ""}`}>
                        <td className="py-2">{item.product_code}</td>
                        <td>{item.description}</td>
                        <td>{item.barcode || "-"}</td>
                        <td>{item.supplier_code || "-"}</td>
                        <td>{item.supplier_name || "-"}</td>
                        <td>{item.local || "-"}</td>
                        <td>{item.street || "-"}</td>
                        <td>{item.allocation_position_code || "-"}</td>
                      </tr>
                    ))}
                    {!products.length && (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan={8}>Nenhum produto encontrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "base" && (
            <div className="space-y-4">
              <form onSubmit={onImportBase} className="workspace-kpi-card space-y-3">
                <h3 className="font-semibold">Importar Base do Estoque</h3>
                <p className="text-sm text-slate-600">
                  Estrutura esperada: Codigo Produto, Descricao, Codigo Barras, Cod Forn., Fornecedor, Local, Rua.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="stock-base-file"
                    className="hidden"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={async (e) => {
                      const file = e.target.files?.[0] || null;
                      setBaseFile(file);
                      if (!file) {
                        setBaseFileBuffer(null);
                        return;
                      }
                      try {
                        const buffer = await file.arrayBuffer();
                        setBaseFileBuffer(buffer);
                      } catch {
                        setBaseFile(null);
                        setBaseFileBuffer(null);
                        setError("Nao foi possivel ler o arquivo selecionado.");
                      }
                    }}
                  />
                  <label htmlFor="stock-base-file" className={`${softButtonClass()} cursor-pointer`}>
                    Escolher base
                  </label>
                  <span className="text-sm text-slate-500">{baseFile?.name || "Nenhum arquivo selecionado"}</span>
                  <button type="submit" disabled={importing} className={primaryButtonClass()}>
                    {importing ? "Importando..." : "Importar Base"}
                  </button>
                </div>
              </form>

              <div className="workspace-kpi-card overflow-auto">
                <h3 className="font-semibold mb-3">Historico de imports da base</h3>
                <table className="workspace-table">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Arquivo</th>
                      <th>Processadas</th>
                      <th>Inseridas</th>
                      <th>Atualizadas</th>
                      <th>Importado por</th>
                      <th>Data/Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="py-2">{item.filename}</td>
                        <td>{item.processed_rows}</td>
                        <td>{item.inserted_rows}</td>
                        <td>{item.updated_rows}</td>
                        <td>{item.imported_by_name || "-"}</td>
                        <td>{new Date(item.created_at).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))}
                    {!imports.length && (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan={6}>Nenhum import realizado ainda.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "abastecimento" && (
            <div className="space-y-4">
              <form onSubmit={onSubmitReplenishment} className="workspace-kpi-card space-y-4">
                <h3 className="font-semibold">Controle de Abastecimento</h3>
                <div className="grid md:grid-cols-5 gap-3">
                  <input className="border rounded-xl px-3 py-2" type="date" value={replenishmentForm.workDate} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, workDate: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" value={replenishmentForm.entryTime} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, entryTime: e.target.value }))} placeholder="Hora" />
                  <input className="border rounded-xl px-3 py-2" placeholder="Codigo Produto (bipado)" value={replenishmentForm.scannedCode} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, scannedCode: e.target.value }))} />
                  <button type="button" className={softButtonClass()} onClick={() => setScannerTarget("abastecimento")}>Escanear</button>
                  <button type="button" className={softButtonClass()} onClick={() => resolveProduct(replenishmentForm.scannedCode, "abastecimento")}>Buscar produto</button>
                </div>

                <div className="grid md:grid-cols-5 gap-3 text-sm">
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={replenishmentProduct?.product_code || ""} placeholder="Cod Produto" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50 md:col-span-2" readOnly value={replenishmentProduct?.description || ""} placeholder="Descricao" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={replenishmentProduct?.supplier_name || ""} placeholder="Fornecedor" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={replenishmentContext?.local || ""} placeholder="Local vindo de Validades" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={replenishmentContext?.street || ""} placeholder="Rua vinda de Validades" />
                </div>

                <div className="grid md:grid-cols-4 gap-3">
                  <input className="border rounded-xl px-3 py-2" placeholder="Quantidade 1" value={replenishmentForm.quantity1} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, quantity1: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" type="date" value={replenishmentForm.expiry1} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, expiry1: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Quantidade 2" value={replenishmentForm.quantity2} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, quantity2: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" type="date" value={replenishmentForm.expiry2} onChange={(e) => setReplenishmentForm((prev) => ({ ...prev, expiry2: e.target.value }))} />
                </div>

                <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span>Usuario: {storedUser?.name || "-"}</span>
                  <button type="submit" disabled={savingReplenishment} className={primaryButtonClass()}>
                    {savingReplenishment ? "Salvando..." : "Registrar abastecimento"}
                  </button>
                </div>
              </form>

              <div className="workspace-kpi-card space-y-3">
                <div className="grid md:grid-cols-4 gap-3">
                  <input className="border rounded-xl px-3 py-2" type="date" value={replenishmentFrom} onChange={(e) => setReplenishmentFrom(e.target.value)} />
                  <input className="border rounded-xl px-3 py-2" type="date" value={replenishmentTo} onChange={(e) => setReplenishmentTo(e.target.value)} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Buscar produto / usuario / local" value={replenishmentSearch} onChange={(e) => setReplenishmentSearch(e.target.value)} />
                  <button type="button" className={softButtonClass()} onClick={() => loadReplenishments().catch(() => setError("Falha ao carregar abastecimentos."))}>Atualizar lista</button>
                </div>
                <div className="overflow-auto">
                  <table className="workspace-table">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Descricao</th>
                        <th>Data</th>
                        <th>Hora</th>
                        <th>Cod Produto</th>
                        <th>Codigo Barras</th>
                        <th>Local</th>
                        <th>Rua</th>
                        <th>Qtd 1</th>
                        <th>Validade 1</th>
                        <th>Qtd 2</th>
                        <th>Validade 2</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replenishments.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="py-2">{item.description}</td>
                          <td>{item.work_date ? new Date(`${item.work_date}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.entry_time || "-"}</td>
                          <td>{item.product_code || "-"}</td>
                          <td>{item.barcode || "-"}</td>
                          <td>{item.local || "-"}</td>
                          <td>{item.street || "-"}</td>
                          <td>{item.quantity_1 ?? "-"}</td>
                          <td>{item.expiry_1 ? new Date(`${item.expiry_1}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.quantity_2 ?? "-"}</td>
                          <td>{item.expiry_2 ? new Date(`${item.expiry_2}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.user_name || "-"}</td>
                        </tr>
                      ))}
                      {!replenishments.length && (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan={12}>Nenhum abastecimento registrado no periodo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "validades" && (
            <div className="space-y-4">
              <form onSubmit={onSubmitExpiration} className="workspace-kpi-card space-y-4">
                <h3 className="font-semibold">Controle de Validades</h3>
                <div className="grid md:grid-cols-4 gap-3">
                  <input className="border rounded-xl px-3 py-2" type="date" value={expirationForm.workDate} onChange={(e) => setExpirationForm((prev) => ({ ...prev, workDate: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Codigo Produto (bipado)" value={expirationForm.scannedCode} onChange={(e) => setExpirationForm((prev) => ({ ...prev, scannedCode: e.target.value }))} />
                  <button type="button" className={softButtonClass()} onClick={() => setScannerTarget("validades")}>Escanear</button>
                  <button type="button" className={softButtonClass()} onClick={() => resolveProduct(expirationForm.scannedCode, "validades")}>Buscar produto</button>
                </div>

                <div className="grid md:grid-cols-5 gap-3 text-sm">
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={expirationProduct?.product_code || ""} placeholder="Cod Produto" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50 md:col-span-2" readOnly value={expirationProduct?.description || ""} placeholder="Descricao" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={expirationProduct?.supplier_name || ""} placeholder="Fornecedor" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={expirationProduct?.barcode || ""} placeholder="Codigo Barras" />
                </div>

                <div className="grid md:grid-cols-5 gap-3">
                  <input className="border rounded-xl px-3 py-2" placeholder="Quantidade" value={expirationForm.quantity} onChange={(e) => setExpirationForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" type="date" value={expirationForm.expiryDate} onChange={(e) => setExpirationForm((prev) => ({ ...prev, expiryDate: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Local" value={expirationForm.local} onChange={(e) => setExpirationForm((prev) => ({ ...prev, local: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Rua / Posicao" value={expirationForm.street} onChange={(e) => setExpirationForm((prev) => ({ ...prev, street: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={storedUser?.name || ""} placeholder="Usuario" />
                </div>

                <div className="flex justify-end">
                  <button type="submit" disabled={savingExpiration} className={primaryButtonClass()}>
                    {savingExpiration ? "Salvando..." : "Registrar validade"}
                  </button>
                </div>
              </form>

              <div className="workspace-kpi-card space-y-3">
                <div className="grid md:grid-cols-4 gap-3">
                  <input className="border rounded-xl px-3 py-2" type="date" value={expirationFrom} onChange={(e) => setExpirationFrom(e.target.value)} />
                  <input className="border rounded-xl px-3 py-2" type="date" value={expirationTo} onChange={(e) => setExpirationTo(e.target.value)} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Buscar produto / usuario / local" value={expirationSearch} onChange={(e) => setExpirationSearch(e.target.value)} />
                  <button type="button" className={softButtonClass()} onClick={() => loadExpirations().catch(() => setError("Falha ao carregar validades."))}>Atualizar lista</button>
                </div>
                <div className="overflow-auto">
                  <table className="workspace-table">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Descricao</th>
                        <th>Data</th>
                        <th>Cod Produto</th>
                        <th>Codigo Barras</th>
                        <th>Local</th>
                        <th>Rua</th>
                        <th>Quantidade</th>
                        <th>Validade</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expirations.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="py-2">{item.description}</td>
                          <td>{item.work_date ? new Date(`${item.work_date}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.product_code || "-"}</td>
                          <td>{item.barcode || "-"}</td>
                          <td>{item.local || "-"}</td>
                          <td>{item.street || "-"}</td>
                          <td>{item.quantity ?? "-"}</td>
                          <td>{item.expiry_date ? new Date(`${item.expiry_date}T00:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
                          <td>{item.user_name || "-"}</td>
                        </tr>
                      ))}
                      {!expirations.length && (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan={9}>Nenhuma validade registrada no periodo.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "alocacao" && (
            <div className="space-y-4">
              <form onSubmit={submitAllocation} className="workspace-kpi-card space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-semibold">{editingAllocationId ? "Editar / mover alocacao" : "Nova alocacao"}</h3>
                  <div className="grid grid-cols-2 gap-1 rounded-xl border p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAllocationMode("single");
                        setAllocationItems([]);
                      }}
                      className={`rounded-lg px-3 py-1 text-sm ${allocationMode === "single" ? "bg-slate-900 text-white" : "bg-white"}`}
                    >
                      Produto
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllocationMode("pallet")}
                      className={`rounded-lg px-3 py-1 text-sm ${allocationMode === "pallet" ? "bg-slate-900 text-white" : "bg-white"}`}
                    >
                      Pallet completo
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-6 gap-3">
                  <input
                    className="border rounded-xl px-3 py-2 md:col-span-2"
                    placeholder="Bipar produto / codigo de barras"
                    value={allocationForm.scannedCode}
                    onChange={(e) => setAllocationForm((prev) => ({ ...prev, scannedCode: e.target.value }))}
                  />
                  <button type="button" className={softButtonClass()} onClick={() => setScannerTarget("alocacao")}>
                    Escanear
                  </button>
                  <button type="button" className={softButtonClass()} onClick={() => resolveProduct(allocationForm.scannedCode, "alocacao")}>
                    Buscar produto
                  </button>
                  <input
                    className="border rounded-xl px-3 py-2"
                    placeholder="Quantidade"
                    value={allocationForm.quantity}
                    onChange={(e) => setAllocationForm((prev) => ({ ...prev, quantity: e.target.value }))}
                  />
                  {allocationMode === "pallet" ? (
                    <button type="button" className={softButtonClass()} onClick={addAllocationItem}>
                      Adicionar ao pallet
                    </button>
                  ) : (
                    <div className="border rounded-xl px-3 py-2 bg-slate-50 text-sm text-slate-500 flex items-center">
                      Modo individual
                    </div>
                  )}
                </div>

                <div className="grid md:grid-cols-4 gap-3 text-sm">
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={allocationProduct?.product_code || ""} placeholder="Cod Produto" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50 md:col-span-2" readOnly value={allocationProduct?.description || ""} placeholder="Descricao" />
                  <input className="border rounded-xl px-3 py-2 bg-slate-50" readOnly value={allocationProduct?.supplier_name || ""} placeholder="Fornecedor" />
                </div>

                {allocationMode === "pallet" && (
                  <div className="workspace-kpi-card overflow-auto">
                    <h4 className="font-semibold mb-2">Produtos do pallet</h4>
                    <table className="workspace-table">
                      <thead>
                        <tr>
                          <th className="py-2">Cod Produto</th>
                          <th>Descricao</th>
                          <th>Quantidade</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocationItems.map((item, index) => (
                          <tr key={`${item.productCode}-${index}`}>
                            <td className="py-2">{item.productCode}</td>
                            <td>{item.description}</td>
                            <td>{item.quantity}</td>
                            <td>
                              <button
                                type="button"
                                className="text-sm text-red-700 underline"
                                onClick={() => setAllocationItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        ))}
                        {!allocationItems.length && (
                          <tr>
                            <td className="py-3 text-slate-500" colSpan={4}>Nenhum produto adicionado ao pallet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="grid md:grid-cols-6 gap-3">
                  <input className="border rounded-xl px-3 py-2" placeholder="Galpao" value={allocationForm.shed} onChange={(e) => setAllocationForm((prev) => ({ ...prev, shed: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Rua" value={allocationForm.street} onChange={(e) => setAllocationForm((prev) => ({ ...prev, street: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Predio" value={allocationForm.building} onChange={(e) => setAllocationForm((prev) => ({ ...prev, building: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Apartamento" value={allocationForm.apartment} onChange={(e) => setAllocationForm((prev) => ({ ...prev, apartment: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Posicao no pallet" value={allocationForm.palletPosition} onChange={(e) => setAllocationForm((prev) => ({ ...prev, palletPosition: e.target.value }))} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Codigo do pallet (opcional)" value={allocationForm.palletCode} onChange={(e) => setAllocationForm((prev) => ({ ...prev, palletCode: e.target.value }))} />
                </div>

                <textarea
                  className="border rounded-xl px-3 py-2 w-full min-h-24"
                  placeholder="Observacoes da alocacao"
                  value={allocationForm.notes}
                  onChange={(e) => setAllocationForm((prev) => ({ ...prev, notes: e.target.value }))}
                />

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm text-slate-500">
                    Posicao final: {allocationForm.shed || "-"}{allocationForm.street || "-"}{allocationForm.building || "-"}{allocationForm.apartment || "-"}{allocationForm.palletPosition || "-"}
                  </span>
                  <div className="flex gap-2">
                    {editingAllocationId && (
                      <button type="button" className={softButtonClass()} onClick={resetAllocationForm}>
                        Cancelar edicao
                      </button>
                    )}
                    <button type="submit" disabled={savingAllocation} className={primaryButtonClass()}>
                      {savingAllocation ? "Salvando..." : editingAllocationId ? "Salvar alocacao" : "Registrar alocacao"}
                    </button>
                  </div>
                </div>
              </form>

              <div className="workspace-kpi-card space-y-3">
                <div className="grid md:grid-cols-3 gap-3">
                  <input className="border rounded-xl px-3 py-2" placeholder="Buscar produto / posicao / fornecedor" value={allocationSearch} onChange={(e) => setAllocationSearch(e.target.value)} />
                  <input className="border rounded-xl px-3 py-2" placeholder="Filtrar por codigo do pallet" value={allocationPalletSearch} onChange={(e) => setAllocationPalletSearch(e.target.value)} />
                  <button type="button" className={softButtonClass()} onClick={() => loadAllocations().catch(() => setError("Falha ao carregar alocacoes."))}>
                    Atualizar alocacoes
                  </button>
                </div>

                <div className="overflow-auto">
                  <table className="workspace-table">
                    <thead>
                      <tr>
                        <th className="py-2">Cod Produto</th>
                        <th>Descricao</th>
                        <th>Qtd</th>
                        <th>Posicao</th>
                        <th>Pallet</th>
                        <th>Modo</th>
                        <th>Operador</th>
                        <th>Atualizado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((row) => (
                        <tr key={row.id}>
                          <td className="py-2">{row.product_code}</td>
                          <td>{row.description}</td>
                          <td>{Number(row.quantity)}</td>
                          <td>{row.position_code}</td>
                          <td>{row.pallet_code || "-"}</td>
                          <td>{row.allocation_mode === "pallet" ? "Pallet completo" : "Produto"}</td>
                          <td>{row.operator_name}</td>
                          <td>{new Date(row.updated_at).toLocaleString("pt-BR")}</td>
                          <td>
                            <button type="button" className="text-sm text-teal-700 underline" onClick={() => editAllocationRow(row)}>
                              Editar / mover
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!allocations.length && (
                        <tr>
                          <td className="py-3 text-slate-500" colSpan={9}>Nenhuma alocacao registrada.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="workspace-kpi-card overflow-auto">
                <h3 className="font-semibold mb-3">Log de alocacao</h3>
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th className="py-2">Data/Hora</th>
                      <th>Acao</th>
                      <th>Produto</th>
                      <th>Qtd</th>
                      <th>Origem</th>
                      <th>Destino</th>
                      <th>Pallet</th>
                      <th>Operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocationLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2">{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                        <td>{log.action_type === "move" ? "Movimentacao" : log.action_type === "update" ? "Edicao" : "Registro"}</td>
                        <td>{log.product_code} - {log.description}</td>
                        <td>{Number(log.quantity)}</td>
                        <td>{log.previous_position_code || "-"}</td>
                        <td>{log.new_position_code}</td>
                        <td>{log.pallet_code || "-"}</td>
                        <td>{log.operator_name}</td>
                      </tr>
                    ))}
                    {!allocationLogs.length && (
                      <tr>
                        <td className="py-3 text-slate-500" colSpan={8}>Nenhum log de alocacao encontrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </section>

      <BarcodeScannerModal
        open={Boolean(scannerTarget)}
        onClose={() => setScannerTarget(null)}
        onDetected={(value) => {
          const target = scannerTarget;
          setScannerTarget(null);
          if (!target) return;
          if (target === "localizar") {
            setScanValue(value);
            resolveProduct(value, "locate");
          }
          if (target === "abastecimento") {
            setReplenishmentForm((prev) => ({ ...prev, scannedCode: value }));
            resolveProduct(value, "abastecimento");
          }
          if (target === "validades") {
            setExpirationForm((prev) => ({ ...prev, scannedCode: value }));
            resolveProduct(value, "validades");
          }
          if (target === "alocacao") {
            setAllocationForm((prev) => ({ ...prev, scannedCode: value }));
            resolveProduct(value, "alocacao");
          }
        }}
      />
    </>
  );
}
