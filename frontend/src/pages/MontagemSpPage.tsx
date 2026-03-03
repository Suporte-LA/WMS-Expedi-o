import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api, buildApiUrl } from "../lib/api";
import type { MontagemSpRecord, User } from "../types";

type PauseEvent = {
  startIso: string;
  endIso: string;
  start: string;
  end: string;
  reason: string;
  minutes: number;
};

type HelperOption = {
  id: string;
  name: string;
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function two(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimeFromDate(date: Date) {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

function formatDateTimeFromIso(iso: string) {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function formatTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  const ss = safe % 60;
  return `${two(hh)}:${two(mm)}:${two(ss)}`;
}

export function MontagemSpPage({ user }: { user: User }) {
  const [workDate, setWorkDate] = useState(isoToday());
  const [sessionStartIso, setSessionStartIso] = useState<string | null>(null);
  const [sessionEndIso, setSessionEndIso] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [pauseStartIso, setPauseStartIso] = useState<string | null>(null);
  const [currentPauseReason, setCurrentPauseReason] = useState("");
  const [pauseEvents, setPauseEvents] = useState<PauseEvent[]>([]);

  const [palletsCount, setPalletsCount] = useState<number | "">("");
  const [loadValue, setLoadValue] = useState<number | "">("");
  const [volume, setVolume] = useState<number | "">("");
  const [weightKg, setWeightKg] = useState<number | "">("");
  const [isoporQty, setIsoporQty] = useState<number | "">("");
  const [hasHelper, setHasHelper] = useState(false);
  const [helperName, setHelperName] = useState("");
  const [helpers, setHelpers] = useState<HelperOption[]>([]);
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

  useEffect(() => {
    if (!isRunning || !sessionStartIso) return;

    const id = window.setInterval(() => {
      const startMs = new Date(sessionStartIso).getTime();
      const nowMs = Date.now();
      const pauseMs = pauseEvents.reduce((acc, event) => acc + event.minutes * 60 * 1000, 0);
      const elapsed = Math.max(0, Math.floor((nowMs - startMs - pauseMs) / 1000));
      setTimerSeconds(elapsed);
    }, 1000);

    return () => window.clearInterval(id);
  }, [isRunning, sessionStartIso, pauseEvents]);

  useEffect(() => {
    async function loadHelpers() {
      try {
        const { data } = await api.get("/montagem-sp/helpers");
        setHelpers(data.items || []);
      } catch {
        setHelpers([]);
      }
    }
    loadHelpers();
  }, []);

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

  const pauseMinutes = useMemo(() => pauseEvents.reduce((acc, event) => acc + event.minutes, 0), [pauseEvents]);
  const stopsCount = pauseEvents.length;

  function startSession() {
    setError("");
    setMessage("");
    if (sessionStartIso) {
      setError("Cronometro ja iniciado.");
      return;
    }
    const nowIso = new Date().toISOString();
    setSessionStartIso(nowIso);
    setSessionEndIso(null);
    setTimerSeconds(0);
    setIsRunning(true);
    setPauseStartIso(null);
    setCurrentPauseReason("");
    setPauseEvents([]);
  }

  function startPause() {
    setError("");
    if (!sessionStartIso || !isRunning) return;
    const nowIso = new Date().toISOString();
    setPauseStartIso(nowIso);
    setIsRunning(false);
  }

  function continueSession() {
    setError("");
    if (!pauseStartIso) return;
    if (!currentPauseReason.trim()) {
      setError("Informe o motivo da parada antes de continuar.");
      return;
    }
    const endIso = new Date().toISOString();
    const minutes = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(pauseStartIso).getTime()) / 60000));

    setPauseEvents((prev) => [
      ...prev,
      {
        startIso: pauseStartIso,
        endIso,
        start: formatDateTimeFromIso(pauseStartIso),
        end: formatDateTimeFromIso(endIso),
        reason: currentPauseReason.trim(),
        minutes
      }
    ]);
    setCurrentPauseReason("");
    setPauseStartIso(null);
    setIsRunning(true);
  }

  function resetForm() {
    setSessionStartIso(null);
    setSessionEndIso(null);
    setTimerSeconds(0);
    setIsRunning(false);
    setPauseStartIso(null);
    setCurrentPauseReason("");
    setPauseEvents([]);
    setPalletsCount("");
    setLoadValue("");
    setVolume("");
    setWeightKg("");
    setIsoporQty("");
    setHasHelper(false);
    setHelperName("");
    setNotes("");
    setPhoto(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!sessionStartIso) {
      setError("Clique em Iniciar para marcar o horario de inicio.");
      return;
    }
    if (pauseStartIso) {
      setError("Existe uma parada em aberto. Informe o motivo e clique em Continuar.");
      return;
    }
    if (!photo) {
      setError("Foto da carga e obrigatoria.");
      return;
    }
    if (hasHelper && !helperName) {
      setError("Selecione o ajudante.");
      return;
    }

    const endIso = new Date().toISOString();
    setSessionEndIso(endIso);

    setLoading(true);
    try {
      const form = new FormData();
      form.append("workDate", workDate);
      form.append("loaderUserName", user.name);
      form.append("startTime", formatTimeFromDate(new Date(sessionStartIso)));
      form.append("endTime", formatTimeFromDate(new Date(endIso)));
      form.append("stopsCount", String(stopsCount));
      form.append("pauseMinutes", String(pauseMinutes));
      form.append(
        "pauseEvents",
        JSON.stringify(
          pauseEvents.map((event) => ({
            start: event.start,
            end: event.end,
            reason: event.reason,
            minutes: event.minutes
          }))
        )
      );
      if (palletsCount !== "") form.append("palletsCount", String(palletsCount));
      if (loadValue !== "") form.append("loadValue", String(loadValue));
      if (volume !== "") form.append("volume", String(volume));
      if (weightKg !== "") form.append("weightKg", String(weightKg));
      if (isoporQty !== "") form.append("isoporQty", String(isoporQty));
      form.append("hasHelper", String(hasHelper));
      if (hasHelper) form.append("helperName", helperName);
      if (notes) form.append("notes", notes);
      form.append("photo", photo);

      await api.post("/montagem-sp", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage("Montagem SP registrada com sucesso.");
      resetForm();
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
      <form onSubmit={onSubmit} className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Montagem SP</h2>
          <p className="text-sm text-slate-600">Fluxo: Iniciar, registrar paradas (se houver), preencher carga, tirar foto e registrar.</p>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Usuario da carga</span>
            <input className="border rounded-xl px-3 py-2 bg-slate-100 w-full" value={user.name} readOnly />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Data da montagem</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </label>
          <div className="md:col-span-2 rounded-xl border px-3 py-2 bg-slate-50">
            <p className="text-xs text-slate-500">Tempo liquido em operacao</p>
            <p className="text-2xl font-bold">{formatTimer(timerSeconds)}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3 items-end">
          <button
            type="button"
            onClick={startSession}
            disabled={Boolean(sessionStartIso)}
            className="rounded-xl bg-emerald-700 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            Iniciar
          </button>
          <button
            type="button"
            onClick={startPause}
            disabled={!sessionStartIso || !isRunning}
            className="rounded-xl bg-amber-600 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            Adicionar parada
          </button>
          <button
            type="button"
            onClick={continueSession}
            disabled={!pauseStartIso}
            className="rounded-xl bg-sky-700 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            Continuar
          </button>
          <div className="text-sm text-slate-600">
            <p>Inicio: {sessionStartIso ? formatDateTimeFromIso(sessionStartIso) : "-"}</p>
            <p>Status: {pauseStartIso ? "Em parada" : isRunning ? "Em andamento" : sessionStartIso ? "Pausado" : "Nao iniciado"}</p>
          </div>
        </div>

        {pauseStartIso && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-amber-800">Parada iniciada em {formatDateTimeFromIso(pauseStartIso)}</p>
            <label className="text-sm block">
              <span className="block mb-1 text-slate-600">Motivo da parada</span>
              <input
                className="border rounded-xl px-3 py-2 w-full"
                value={currentPauseReason}
                onChange={(e) => setCurrentPauseReason(e.target.value)}
                placeholder="Ex: aguardando liberacao de doca"
              />
            </label>
          </div>
        )}

        {pauseEvents.length > 0 && (
          <div className="rounded-xl border p-3">
            <p className="font-semibold mb-2">Paradas registradas</p>
            <ul className="text-sm space-y-1">
              {pauseEvents.map((event, index) => (
                <li key={`${event.startIso}-${index}`}>
                  {index + 1}. {event.start} ate {event.end} ({event.minutes} min) - {event.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Qtde palete</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={palletsCount} onChange={(e) => setPalletsCount(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Valor da carga</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} step="0.01" value={loadValue} onChange={(e) => setLoadValue(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Volume</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={volume} onChange={(e) => setVolume(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Peso (kg)</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Isopor</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={isoporQty} onChange={(e) => setIsoporQty(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <label className="text-sm flex items-center gap-2 border rounded-xl px-3 py-2 h-[42px]">
            <input type="checkbox" checked={hasHelper} onChange={(e) => { setHasHelper(e.target.checked); if (!e.target.checked) setHelperName(""); }} />
            Teve ajudante?
          </label>

          {hasHelper && (
            <label className="text-sm md:col-span-2">
              <span className="block mb-1 text-slate-600">Quem ajudou (sem admin)</span>
              <select className="border rounded-xl px-3 py-2 w-full" value={helperName} onChange={(e) => setHelperName(e.target.value)}>
                <option value="">Selecione um usuario</option>
                {helpers.map((helper) => (
                  <option key={helper.id} value={helper.name}>{helper.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="flex items-end gap-2">
            <input id="montagem-photo" className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            <label htmlFor="montagem-photo" className="rounded-xl border px-3 py-2 cursor-pointer whitespace-nowrap">Tirar foto da carga</label>
            <span className="text-sm text-slate-500 truncate">{photo?.name || "Nenhuma foto"}</span>
          </div>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Observacoes</span>
            <input className="border rounded-xl px-3 py-2 w-full" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </label>
        </div>

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50">
            {loading ? "Salvando..." : "Registrar montagem"}
          </button>
          <button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 px-5 py-2 font-semibold">
            Limpar
          </button>
        </div>

        <div className="text-sm text-slate-600">
          <p>Paradas: {stopsCount}</p>
          <p>Total parado: {pauseMinutes} min</p>
          {sessionEndIso ? <p>Termino: {formatDateTimeFromIso(sessionEndIso)}</p> : null}
        </div>

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
              <th>Tempo (min)</th>
              <th>Paradas</th>
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
                <td>{item.stops_count ?? 0}</td>
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
