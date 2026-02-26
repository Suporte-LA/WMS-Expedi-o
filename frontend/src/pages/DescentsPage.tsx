import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { DescentRecord, OrderCatalogRecord, User } from "../types";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
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
  const lookupSeqRef = useRef(0);

  function normalizeOrder(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits || value.trim();
  }

  function hasCompleteOrderInfo(info: OrderCatalogRecord | null) {
    if (!info) return false;
    return Boolean(
      info.lot &&
        info.route &&
        info.description &&
        info.volume !== null &&
        info.volume !== undefined &&
        info.weight_kg !== null &&
        info.weight_kg !== undefined
    );
  }

  async function loadRecent() {
    const list = await api.get(`/descents?page=1&pageSize=30`);
    setRecords(list.data.items || []);
  }

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
  }, []);

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
    if (!hasCompleteOrderInfo(orderInfo)) {
      setError("Preencha a Base deste pedido antes de registrar (lote, quantidade, peso, rota e descricao).");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("orderNumber", normalizeOrder(orderNumber));
      form.append("workDate", workDate);
      form.append("image", image);

      await api.post("/descents", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage("Pedido descido registrado com sucesso.");
      setOrderNumber("");
      setOrderInfo(null);
      setImage(null);
      await loadRecent();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar descida.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="space-y-4">
        <form onSubmit={submitDescent} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h2 className="font-semibold">Descer Pedidos</h2>
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

          <button
            type="submit"
            className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50"
            disabled={loading || !hasCompleteOrderInfo(orderInfo) || !image || !workDate || !orderNumber.trim()}
          >
            {loading ? "Salvando..." : "Registrar descida"}
          </button>
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!orderInfo && orderNumber && (
            <p className="text-sm text-amber-700">Pedido sem base cadastrada para lote/peso/volume/rota/descricao.</p>
          )}
          {orderInfo && !hasCompleteOrderInfo(orderInfo) && (
            <p className="text-sm text-amber-700">Base incompleta para esse pedido. Complete os campos obrigatorios.</p>
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
                      <a className="underline" href={`/api${item.product_image_path}`} target="_blank" rel="noreferrer">
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
    </>
  );
}
