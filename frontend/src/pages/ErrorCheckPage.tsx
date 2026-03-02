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
  volume?: number | null;
  route?: string | null;
};

const ERROR_OPTIONS = [
  "Doca Errada",
  "Faltando Volume",
  "Caixa a mais em Pedido",
  "Caixa a mais em Pedido e doca errada",
  "Caixa no meio do palete",
  "Caixa no remanjado"
];

export function ErrorCheckPage({ user }: { user: User }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [problemType, setProblemType] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [lookup, setLookup] = useState<LookupData | null>(null);
  const [dock, setDock] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  async function searchOrder(value?: string) {
    const scanned = (value ?? orderNumber).trim();
    if (!scanned) return;
    setLookup(null);
    setError("");
    setMessage("");
    try {
      const { data } = await api.get(`/descents/lookup/${encodeURIComponent(scanned)}`);
      setOrderNumber(data.order_number || scanned);
      setLookup(data);
      setDock(data.route || "");
      setReportDate((data.work_date || "").slice(0, 10));
      setProblemType("");
      setImage(null);
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
    if (!lookup) {
      setError("Bipe um pedido valido para preencher os dados automaticamente.");
      return;
    }
    if (!problemType) {
      setError("Selecione qual erro gerado.");
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
      form.append("finalized", "true");
      form.append("dock", dock);
      form.append("reportDate", reportDate || lookup.work_date.slice(0, 10));
      form.append("image", image);
      await api.post("/errors", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage("Erro registrado com sucesso.");
      setOrderNumber("");
      setLookup(null);
      setDock("");
      setReportDate("");
      setProblemType("");
      setImage(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar erro.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        <form onSubmit={submitError} className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="font-semibold">Conferencia de Erros</h2>

          <div className="grid md:grid-cols-2 gap-3">
            <input className="border rounded-xl px-3 py-2 bg-slate-100" value={user.name} readOnly />
            <div className="flex gap-2">
              <input
                className="border rounded-xl px-3 py-2 flex-1"
                placeholder="Pedido (bipado)"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
              />
              <button type="button" onClick={() => searchOrder()} className="rounded-xl border px-3">
                Buscar
              </button>
              <button type="button" onClick={() => setScannerOpen(true)} className="rounded-xl border px-3">
                Escanear
              </button>
            </div>
          </div>

          {lookup && (
            <div className="grid md:grid-cols-5 gap-3">
              <input className="border rounded-xl px-3 py-2 bg-slate-50" value={dock || "-"} placeholder="Doca" readOnly />
              <input
                className="border rounded-xl px-3 py-2 bg-slate-50"
                value={lookup.volume ?? "-"}
                placeholder="Volume"
                readOnly
              />
              <input
                className="border rounded-xl px-3 py-2 bg-slate-50"
                value={lookup.descended_by_name || "-"}
                placeholder="Quem desceu"
                readOnly
              />
              <input
                className="border rounded-xl px-3 py-2 bg-slate-50"
                value={lookup.pen_color || "-"}
                placeholder="Cor da caneta"
                readOnly
              />
              <input
                className="border rounded-xl px-3 py-2 bg-slate-50"
                value={reportDate || "-"}
                placeholder="Data"
                readOnly
              />
            </div>
          )}

          {lookup && (
            <div className="space-y-3">
              <label className="text-sm font-semibold text-slate-700">Qual erro gerado</label>
              <select
                className="w-full border rounded-xl px-3 py-2"
                value={problemType}
                onChange={(e) => setProblemType(e.target.value)}
              >
                <option value="">Selecione...</option>
                {ERROR_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
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
            </div>
          )}

          <button
            type="submit"
            className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50"
            disabled={loading || !lookup || !problemType || !image}
          >
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
          await searchOrder(value);
        }}
      />
    </>
  );
}
