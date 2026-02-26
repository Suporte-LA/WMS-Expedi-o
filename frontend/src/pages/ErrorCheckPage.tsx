import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { User } from "../types";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";

type LookupData = {
  order_number: string;
  descended_by_name: string;
  pen_color: string;
  work_date: string;
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

const PROBLEMS = ["VOL", "Caixa em doca errada", "Data errada", "Caixa a mais", "Caixa trocada"];

export function ErrorCheckPage({ user }: { user: User }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [problemType, setProblemType] = useState(PROBLEMS[0]);
  const [finalized, setFinalized] = useState(true);
  const [dock, setDock] = useState("");
  const [reportDate, setReportDate] = useState(isoToday());
  const [image, setImage] = useState<File | null>(null);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  async function searchOrder() {
    if (!orderNumber.trim()) return;
    setLookup(null);
    setError("");
    try {
      const { data } = await api.get(`/descents/lookup/${encodeURIComponent(orderNumber.trim())}`);
      setLookup(data);
    } catch {
      setError("Pedido nao encontrado em descidas.");
    }
  }

  async function submitError(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!orderNumber.trim()) {
      setError("Informe o pedido.");
      return;
    }
    if (!image) {
      setError("Imagem da evidencia e obrigatoria.");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("orderNumber", orderNumber.trim());
      form.append("problemType", problemType);
      form.append("finalized", String(finalized));
      form.append("dock", dock);
      form.append("reportDate", reportDate);
      form.append("image", image);
      await api.post("/errors", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage("Erro registrado com sucesso.");
      setOrderNumber("");
      setDock("");
      setImage(null);
      setLookup(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar erro.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        <form onSubmit={submitError} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h2 className="font-semibold">Conferencia de Erros</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <input className="border rounded-xl px-3 py-2 bg-slate-100" value={user.name} readOnly />
            <input className="border rounded-xl px-3 py-2 bg-slate-100" value={reportDate} readOnly />
            <div className="flex gap-2">
              <input
                className="border rounded-xl px-3 py-2 flex-1"
                placeholder="Pedido (bipado)"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
              <button type="button" onClick={searchOrder} className="rounded-xl border px-3">
                Buscar
              </button>
              <button type="button" onClick={() => setScannerOpen(true)} className="rounded-xl border px-3">
                Escanear
              </button>
            </div>
            <input className="border rounded-xl px-3 py-2" placeholder="Doca" value={dock} onChange={(e) => setDock(e.target.value)} />
            <select className="border rounded-xl px-3 py-2" value={problemType} onChange={(e) => setProblemType(e.target.value)}>
              {PROBLEMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              className="border rounded-xl px-3 py-2"
              value={finalized ? "true" : "false"}
              onChange={(e) => setFinalized(e.target.value === "true")}
            >
              <option value="false">Finalizado: Nao</option>
              <option value="true">Finalizado: Sim</option>
            </select>
            <div className="flex items-center gap-2">
              <input
                id="error-photo"
                className="hidden"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setImage(e.target.files?.[0] || null)}
              />
              <label htmlFor="error-photo" className="rounded-xl border px-3 py-2 cursor-pointer whitespace-nowrap">
                Tirar foto
              </label>
              <span className="text-sm text-slate-500 truncate">{image?.name || "Nenhuma foto selecionada"}</span>
            </div>
            <input className="border rounded-xl px-3 py-2" type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </div>

          {lookup && (
            <div className="bg-slate-50 rounded-xl p-3 text-sm">
              <p>Usuario que desceu: {lookup.descended_by_name}</p>
              <p>Cor da caneta: {lookup.pen_color}</p>
              <p>Data da descida: {lookup.work_date?.slice(0, 10)}</p>
            </div>
          )}

          <button type="submit" className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold" disabled={loading}>
            {loading ? "Salvando..." : "Registrar erro"}
          </button>
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </form>
      </section>
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={async (value) => {
          setOrderNumber(value);
          setLookup(null);
          setError("");
          try {
            const { data } = await api.get(`/descents/lookup/${encodeURIComponent(value.trim())}`);
            setLookup(data);
          } catch {
            setError("Pedido nao encontrado em descidas.");
          }
        }}
      />
    </>
  );
}
