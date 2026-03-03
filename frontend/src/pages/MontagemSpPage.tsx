import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, buildApiUrl } from "../lib/api";
import type { MontagemSpRecord, User } from "../types";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function MontagemSpPage({ user }: { user: User }) {
  const [workDate, setWorkDate] = useState(isoToday());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [stopsCount, setStopsCount] = useState(0);
  const [pauseMinutes, setPauseMinutes] = useState(0);
  const [pauseReason, setPauseReason] = useState("");
  const [palletsCount, setPalletsCount] = useState<number | "">("");
  const [loadValue, setLoadValue] = useState<number | "">("");
  const [volume, setVolume] = useState<number | "">("");
  const [weightKg, setWeightKg] = useState<number | "">("");
  const [isoporQty, setIsoporQty] = useState<number | "">("");
  const [hasHelper, setHasHelper] = useState(false);
  const [helperName, setHelperName] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [filterUser, setFilterUser] = useState("");
  const [items, setItems] = useState<MontagemSpRecord[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadList() {
    const params = new URLSearchParams({ from, to, page: "1", pageSize: "100" });
    if (filterUser.trim()) params.set("user", filterUser.trim());
    const { data } = await api.get(`/montagem-sp?${params.toString()}`);
    setItems(data.items || []);
    setSummary(data.summary || null);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!photo) {
      setError("Foto da carga e obrigatoria.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("workDate", workDate);
      form.append("loaderUserName", user.name);
      if (startTime) form.append("startTime", startTime);
      if (endTime) form.append("endTime", endTime);
      form.append("stopsCount", String(stopsCount || 0));
      form.append("pauseMinutes", String(pauseMinutes || 0));
      if (pauseReason) form.append("pauseReason", pauseReason);
      if (palletsCount !== "") form.append("palletsCount", String(palletsCount));
      if (loadValue !== "") form.append("loadValue", String(loadValue));
      if (volume !== "") form.append("volume", String(volume));
      if (weightKg !== "") form.append("weightKg", String(weightKg));
      if (isoporQty !== "") form.append("isoporQty", String(isoporQty));
      form.append("hasHelper", String(hasHelper));
      if (hasHelper && helperName) form.append("helperName", helperName);
      if (notes) form.append("notes", notes);
      form.append("photo", photo);

      await api.post("/montagem-sp", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage("Carga de Montagem SP registrada com sucesso.");
      setStartTime("");
      setEndTime("");
      setStopsCount(0);
      setPauseMinutes(0);
      setPauseReason("");
      setPalletsCount("");
      setLoadValue("");
      setVolume("");
      setWeightKg("");
      setIsoporQty("");
      setHasHelper(false);
      setHelperName("");
      setNotes("");
      setPhoto(null);
      await loadList();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao registrar montagem.");
    } finally {
      setLoading(false);
    }
  }

  async function onFilter(e: FormEvent) {
    e.preventDefault();
    await loadList();
  }

  async function exportXlsx() {
    try {
      const params = new URLSearchParams({ from, to, export: "xlsx" });
      if (filterUser.trim()) params.set("user", filterUser.trim());
      const response = await api.get(`/montagem-sp?${params.toString()}`, { responseType: "blob" });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "montagem_sp.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao exportar Montagem SP.");
    }
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onSubmit} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <h2 className="font-semibold">Montagem SP</h2>
        <div className="grid md:grid-cols-4 gap-3">
          <input className="border rounded-xl px-3 py-2 bg-slate-100" value={user.name} readOnly />
          <input className="border rounded-xl px-3 py-2" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          <input className="border rounded-xl px-3 py-2" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <input className="border rounded-xl px-3 py-2" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />

          <input className="border rounded-xl px-3 py-2" type="number" min={0} placeholder="Paradas" value={stopsCount} onChange={(e) => setStopsCount(Number(e.target.value || 0))} />
          <input className="border rounded-xl px-3 py-2" type="number" min={0} placeholder="Parada (min)" value={pauseMinutes} onChange={(e) => setPauseMinutes(Number(e.target.value || 0))} />
          <input className="border rounded-xl px-3 py-2 md:col-span-2" placeholder="Motivo da parada" value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} />

          <input className="border rounded-xl px-3 py-2" type="number" min={0} placeholder="Quantidade de palete" value={palletsCount} onChange={(e) => setPalletsCount(e.target.value === "" ? "" : Number(e.target.value))} />
          <input className="border rounded-xl px-3 py-2" type="number" min={0} step="0.01" placeholder="Valor da carga" value={loadValue} onChange={(e) => setLoadValue(e.target.value === "" ? "" : Number(e.target.value))} />
          <input className="border rounded-xl px-3 py-2" type="number" min={0} placeholder="Volume" value={volume} onChange={(e) => setVolume(e.target.value === "" ? "" : Number(e.target.value))} />
          <input className="border rounded-xl px-3 py-2" type="number" min={0} step="0.01" placeholder="Peso (kg)" value={weightKg} onChange={(e) => setWeightKg(e.target.value === "" ? "" : Number(e.target.value))} />

          <input className="border rounded-xl px-3 py-2" type="number" min={0} placeholder="Isopor" value={isoporQty} onChange={(e) => setIsoporQty(e.target.value === "" ? "" : Number(e.target.value))} />
          <label className="border rounded-xl px-3 py-2 flex items-center gap-2">
            <input type="checkbox" checked={hasHelper} onChange={(e) => setHasHelper(e.target.checked)} />
            Teve ajudante?
          </label>
          <input className="border rounded-xl px-3 py-2" placeholder="Quem ajudou" value={helperName} onChange={(e) => setHelperName(e.target.value)} disabled={!hasHelper} />
          <div className="flex items-center gap-2">
            <input id="montagem-photo" className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            <label htmlFor="montagem-photo" className="rounded-xl border px-3 py-2 cursor-pointer whitespace-nowrap">Tirar foto</label>
            <span className="text-sm text-slate-500 truncate">{photo?.name || "Sem foto"}</span>
          </div>
        </div>

        <textarea className="border rounded-xl px-3 py-2 w-full" placeholder="Observacoes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        <button type="submit" disabled={loading} className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50">
          {loading ? "Salvando..." : "Registrar Montagem SP"}
        </button>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>

      <form onSubmit={onFilter} className="bg-white rounded-2xl p-4 shadow-sm grid md:grid-cols-4 gap-3">
        <input className="border rounded-xl px-3 py-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="border rounded-xl px-3 py-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="border rounded-xl px-3 py-2" placeholder="Usuario (opcional)" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} />
        <div className="flex gap-2">
          <button className="rounded-xl border border-slate-300 px-4 font-semibold">Filtrar</button>
          <button type="button" onClick={exportXlsx} className="rounded-xl border border-amber-500 text-amber-700 px-4 font-semibold">
            Exportar XLSX
          </button>
        </div>
      </form>

      {summary && (
        <div className="grid md:grid-cols-5 gap-3">
          <article className="bg-white rounded-2xl p-4 shadow-sm"><p className="text-sm text-slate-500">Registros</p><p className="text-2xl font-bold">{summary.total_registros || 0}</p></article>
          <article className="bg-white rounded-2xl p-4 shadow-sm"><p className="text-sm text-slate-500">Volume</p><p className="text-2xl font-bold">{summary.total_volume || 0}</p></article>
          <article className="bg-white rounded-2xl p-4 shadow-sm"><p className="text-sm text-slate-500">Peso KG</p><p className="text-2xl font-bold">{summary.total_peso || 0}</p></article>
          <article className="bg-white rounded-2xl p-4 shadow-sm"><p className="text-sm text-slate-500">Isopor</p><p className="text-2xl font-bold">{summary.total_isopor || 0}</p></article>
          <article className="bg-white rounded-2xl p-4 shadow-sm"><p className="text-sm text-slate-500">Parada (min)</p><p className="text-2xl font-bold">{summary.total_parada_min || 0}</p></article>
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
        <h3 className="font-semibold mb-3">Historico Montagem SP</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Data</th>
              <th>Usuario</th>
              <th>Inicio</th>
              <th>Termino</th>
              <th>Tempo</th>
              <th>Volume</th>
              <th>Peso</th>
              <th>Isopor</th>
              <th>Ajudante</th>
              <th>Foto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.work_date?.slice(0, 10)}</td>
                <td>{item.loader_user_name}</td>
                <td>{item.start_time || "-"}</td>
                <td>{item.end_time || "-"}</td>
                <td>{item.duration_minutes ?? "-"}</td>
                <td>{item.volume ?? "-"}</td>
                <td>{item.weight_kg ?? "-"}</td>
                <td>{item.isopor_qty ?? "-"}</td>
                <td>{item.has_helper ? item.helper_name || "SIM" : "NAO"}</td>
                <td>{item.photo_path ? <a className="underline" href={buildApiUrl(item.photo_path)} target="_blank" rel="noreferrer">abrir</a> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
