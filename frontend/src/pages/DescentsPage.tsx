import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import { api, buildApiUrl } from "../lib/api";
import { buildQueueFile, flushOperationalQueue, submitQueuedOperation } from "../lib/offlineQueue";
import type { DailyDockAssignment, DescentRecord, OrderCatalogRecord, User } from "../types";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ message?: string }>(error)) return error.response?.data?.message || fallback;
  return fallback;
}

export function DescentsPage({ user }: { user: User }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [workDate, setWorkDate] = useState(isoToday());
  const [image, setImage] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [orderInfo, setOrderInfo] = useState<OrderCatalogRecord | null>(null);
  const [records, setRecords] = useState<DescentRecord[]>([]);
  const [dockModalOpen, setDockModalOpen] = useState(false);
  const [dockAssignments, setDockAssignments] = useState<DailyDockAssignment[]>([]);
  const [dockLoading, setDockLoading] = useState(false);
  const [dockError, setDockError] = useState("");
  const lookupSeqRef = useRef(0);

  function normalizeOrder(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits || value.trim();
  }

  async function loadRecent() {
    const list = await api.get(`/descents?page=1&pageSize=30`);
    setRecords(list.data.items || []);
  }

  async function loadDockAssignments(date = workDate) {
    try {
      const { data } = await api.get(`/descents/dock-assignments?date=${encodeURIComponent(date)}`);
      setDockAssignments(data.items || []);
      setDockError("");
    } catch {
      setDockAssignments([]);
      setDockError("Falha ao carregar o registro de docas.");
    }
  }

  async function saveDockAssignment(item: DailyDockAssignment, dockPosition: "frente" | "tras") {
    setDockLoading(true);
    setDockError("");
    try {
      await api.post("/descents/dock-assignments", {
        workDate,
        routeCode: item.route_code,
        routeName: item.route_name || item.route_code,
        dockPosition
      });
      await loadDockAssignments();
    } catch (err: unknown) {
      setDockError(apiErrorMessage(err, "Falha ao salvar o registro de doca."));
    } finally {
      setDockLoading(false);
    }
  }

  async function deleteDockAssignment(id?: string | null) {
    if (!id) return;
    setDockError("");
    try {
      await api.delete(`/descents/dock-assignments/${id}`);
      await loadDockAssignments();
    } catch (err: unknown) {
      setDockError(apiErrorMessage(err, "Falha ao remover o registro de doca."));
    }
  }

  const currentDock = orderInfo?.route
    ? dockAssignments.find(
        (item) => item.dock_position && item.route_code.trim().toLowerCase() === orderInfo.route?.trim().toLowerCase()
      )
    : undefined;

  async function lookupOrder(order: string) {
    const normalized = normalizeOrder(order);
    if (!normalized || normalized.length < 6) {
      setOrderInfo(null);
      return;
    }

    const seq = ++lookupSeqRef.current;
    try {
      const { data } = await api.get(`/descents/catalog/${encodeURIComponent(normalized)}`);
      if (seq !== lookupSeqRef.current) return;
      setOrderInfo(data);
    } catch {
      if (seq !== lookupSeqRef.current) return;
      setOrderInfo(null);
    }
  }

  useEffect(() => {
    loadRecent();
    loadDockAssignments();
  }, []);

  useEffect(() => {
    loadDockAssignments(workDate);
  }, [workDate]);

  useEffect(() => {
    const t = setTimeout(() => {
      lookupOrder(orderNumber);
    }, 250);
    return () => clearTimeout(t);
  }, [orderNumber]);

  async function submitDescent(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!orderNumber.trim()) {
      setError("Informe o pedido para registrar a descida.");
      return;
    }
    if (!workDate) {
      setError("Data e obrigatoria.");
      return;
    }
    if (!image) {
      setError("Foto do produto e obrigatoria.");
      return;
    }
    setLoading(true);
    try {
      const result = await submitQueuedOperation("descent", {
        orderNumber: normalizeOrder(orderNumber),
        workDate,
        image: buildQueueFile(image)
      });
      if (result.status === "sent") {
        setMessage("Pedido descido registrado com sucesso.");
        await loadRecent();
      } else {
        setMessage("Registro salvo localmente e pendente de sincronizacao. Ele sera enviado automaticamente quando a conexao estabilizar.");
      }
      setOrderNumber("");
      setOrderInfo(null);
      setImage(null);
      void flushOperationalQueue();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "Falha ao registrar descida."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        <form onSubmit={submitDescent} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold">Descer Pedidos</h2>
            <button type="button" onClick={() => setDockModalOpen(true)} className="rounded-xl border border-cyan-600 px-4 py-2 text-sm font-semibold text-cyan-700">
              Registro de doca diaria
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input className="border rounded-xl px-3 py-2 bg-slate-100 md:col-span-2" value={user.name} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-100 md:col-span-2" value={user.pen_color || "Blue"} readOnly />
            <div className="flex gap-2 min-w-0 md:col-span-3">
              <input
                className="border rounded-xl px-3 py-2 flex-1 min-w-0"
                placeholder="Pedido (bipado)"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
              <button type="button" className="rounded-xl border px-3 shrink-0" onClick={() => setScannerOpen(true)}>
                Escanear
              </button>
            </div>
            <input
              className="border rounded-xl px-3 py-2 md:col-span-2"
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
            />
            <div className="md:col-span-3 flex items-center gap-2">
              <input
                id="descent-photo"
                className="hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setImage(e.target.files?.[0] || null)}
              />
              <label htmlFor="descent-photo" className="rounded-xl border px-3 py-2 cursor-pointer whitespace-nowrap">
                Tirar foto
              </label>
              <span className="text-sm text-slate-500 truncate">{image?.name || "Nenhuma foto selecionada"}</span>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Lote" value={orderInfo?.lot || ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Quantidade" value={orderInfo?.volume ?? ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Peso" value={orderInfo?.weight_kg ?? ""} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-50" placeholder="Rota" value={orderInfo?.route || ""} readOnly />
          </div>

          <input className="border rounded-xl px-3 py-2 bg-slate-50 w-full" placeholder="Descricao" value={orderInfo?.description || ""} readOnly />

          {orderInfo && currentDock && (
            <div className={`rounded-2xl border-2 p-4 text-center ${currentDock.dock_position === "frente" ? "border-blue-500 bg-blue-50 text-blue-900" : "border-orange-500 bg-orange-50 text-orange-900"}`}>
              <p className="text-sm font-semibold">{currentDock.route_code} - {currentDock.route_name}</p>
              <p className="text-3xl font-black uppercase">Doca: {currentDock.dock_position === "frente" ? "Frente" : "Tras"}</p>
            </div>
          )}
          {orderInfo?.route && !currentDock && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Rota {orderInfo.route} sem doca cadastrada para {workDate}.</p>
          )}

          <button
            type="submit"
            className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50"
            disabled={loading || !image || !workDate || !orderNumber.trim()}
          >
            {loading ? "Salvando..." : "Registrar descida"}
          </button>
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!orderInfo && orderNumber && (
            <p className="text-sm text-amber-700">Pedido sem base cadastrada para lote/peso/volume/rota/descricao.</p>
          )}
          {orderInfo && (
            <p className="text-sm text-slate-600">Dados de base preenchidos automaticamente quando disponiveis.</p>
          )}
          {!image && <p className="text-sm text-amber-700">Foto obrigatoria para registrar descida.</p>}
        </form>

        <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
          <h3 className="font-semibold mb-3">Ultimas descidas</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Data</th>
                <th>Pedido</th>
                <th>Lote</th>
                <th>Qtd</th>
                <th>Peso</th>
                <th>Rota</th>
                <th>Usuario</th>
                <th>Cor</th>
                <th>Imagem</th>
              </tr>
            </thead>
            <tbody>
              {records.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{item.work_date?.slice(0, 10)}</td>
                  <td>{item.order_number}</td>
                  <td>{item.lot || "-"}</td>
                  <td>{item.volume ?? "-"}</td>
                  <td>{item.weight_kg ?? "-"}</td>
                  <td>{item.route || "-"}</td>
                  <td>{item.descended_by_name}</td>
                  <td>{item.pen_color}</td>
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
            </tbody>
          </table>
        </div>
      </section>
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(value) => {
          const normalized = normalizeOrder(value);
          setOrderNumber(normalized);
          lookupOrder(normalized);
        }}
      />
      {dockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDockModalOpen(false)} />
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h2 className="font-semibold">Registro de doca diaria</h2><p className="text-sm text-slate-600">Data: {workDate}</p></div>
              <button type="button" className="rounded-lg border px-3 py-1" onClick={() => setDockModalOpen(false)}>Fechar</button>
            </div>
            <p className="mb-4 rounded-xl bg-cyan-50 p-3 text-sm text-cyan-900">As rotas abaixo foram carregadas automaticamente da base do próximo dia útil. Marque somente onde cada rota deve ser descarregada.</p>
            {dockError && <p className="mb-3 text-sm text-red-700">{dockError}</p>}
            <div className="overflow-auto">
              <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Rota</th><th>Pedidos</th><th>Posicao da doca</th><th>Definido por</th><th></th></tr></thead><tbody>
                {dockAssignments.map((item) => <tr className="border-b" key={item.route_code}><td className="py-3 font-semibold">{item.route_code}</td><td>{item.orders_count}</td><td><div className="flex gap-2"><button type="button" disabled={dockLoading || !(user.role === "admin" || user.role === "supervisor")} onClick={() => saveDockAssignment(item, "frente")} className={`rounded-lg border px-3 py-2 font-bold disabled:cursor-not-allowed ${item.dock_position === "frente" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>Frente</button><button type="button" disabled={dockLoading || !(user.role === "admin" || user.role === "supervisor")} onClick={() => saveDockAssignment(item, "tras")} className={`rounded-lg border px-3 py-2 font-bold disabled:cursor-not-allowed ${item.dock_position === "tras" ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300 bg-white"}`}>Tras</button></div></td><td>{item.created_by_name || "-"}</td><td>{(user.role === "admin" || user.role === "supervisor") && item.id && <button type="button" className="text-red-700 underline" onClick={() => deleteDockAssignment(item.id)}>Limpar</button>}</td></tr>)}
                {!dockAssignments.length && <tr><td colSpan={5} className="py-4 text-slate-500">Nenhuma rota cadastrada para esta data.</td></tr>}
              </tbody></table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
