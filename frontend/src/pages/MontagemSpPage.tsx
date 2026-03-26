import { Fragment, useEffect, useMemo, useState } from "react";
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

type EditFormState = {
  workDate: string;
  startTime: string;
  endTime: string;
  stopsCount: string;
  pauseMinutes: string;
  pauseReason: string;
  palletsCount: string;
  loadValue: string;
  volume: string;
  weightKg: string;
  isoporQty: string;
  hasHelper: boolean;
  helperName: string;
  notes: string;
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

function calculateElapsedSeconds(startIso: string, endIso: string, pauses: PauseEvent[]) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const pauseMs = pauses.reduce((acc, event) => acc + event.minutes * 60 * 1000, 0);
  return Math.max(0, Math.floor((endMs - startMs - pauseMs) / 1000));
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toEditForm(item: MontagemSpRecord): EditFormState {
  return {
    workDate: item.work_date?.slice(0, 10) || "",
    startTime: item.start_time || "",
    endTime: item.end_time || "",
    stopsCount: stringValue(item.stops_count),
    pauseMinutes: stringValue(item.pause_minutes),
    pauseReason: item.pause_reason || "",
    palletsCount: stringValue(item.pallets_count),
    loadValue: stringValue(item.load_value),
    volume: stringValue(item.volume),
    weightKg: stringValue(item.weight_kg),
    isoporQty: stringValue(item.isopor_qty),
    hasHelper: Boolean(item.has_helper),
    helperName: item.helper_name || "",
    notes: item.notes || ""
  };
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!isRunning || !sessionStartIso) return;

    const id = window.setInterval(() => {
      const endIso = new Date().toISOString();
      setTimerSeconds(calculateElapsedSeconds(sessionStartIso, endIso, pauseEvents));
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
  const completionUnlocked = Boolean(photo && sessionEndIso);

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
    setPhoto(null);
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

  function finalizeByPhoto(file: File | null) {
    setMessage("");
    setError("");
    setPhoto(file);
    if (!file) return;
    if (!sessionStartIso) {
      setError("Clique em Iniciar antes de tirar a foto.");
      return;
    }
    if (pauseStartIso) {
      setError("Existe uma parada em aberto. Informe o motivo e clique em Continuar antes da foto.");
      return;
    }
    const endIso = new Date().toISOString();
    setSessionEndIso(endIso);
    setIsRunning(false);
    setTimerSeconds(calculateElapsedSeconds(sessionStartIso, endIso, pauseEvents));
    setMessage("Foto registrada. Agora preencha os dados finais ou use Registrar depois.");
  }

  async function persistRecord(mode: "complete" | "later") {
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
    if (!photo || !sessionEndIso) {
      setError("Tire a foto da carga para finalizar o contador.");
      return;
    }
    if (hasHelper && !helperName) {
      setError("Selecione o ajudante.");
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append("workDate", workDate);
      form.append("loaderUserName", user.name);
      form.append("startTime", formatTimeFromDate(new Date(sessionStartIso)));
      form.append("endTime", formatTimeFromDate(new Date(sessionEndIso)));
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
      if (mode === "complete") {
        if (palletsCount !== "") form.append("palletsCount", String(palletsCount));
        if (loadValue !== "") form.append("loadValue", String(loadValue));
        if (volume !== "") form.append("volume", String(volume));
        if (weightKg !== "") form.append("weightKg", String(weightKg));
        if (isoporQty !== "") form.append("isoporQty", String(isoporQty));
      }
      form.append("hasHelper", String(hasHelper));
      if (hasHelper) form.append("helperName", helperName);
      if (notes) form.append("notes", notes);
      form.append("photo", photo);

      await api.post("/montagem-sp", form, { headers: { "Content-Type": "multipart/form-data" } });
      setMessage(mode === "later" ? "Montagem SP registrada sem os informes finais. Use Editar depois." : "Montagem SP registrada com sucesso.");
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

  function startEdit(item: MontagemSpRecord) {
    setEditingId(item.id);
    setEditForm(toEditForm(item));
    setError("");
    setMessage("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit() {
    if (!editingId || !editForm) return;
    setSavingEdit(true);
    setError("");
    setMessage("");
    try {
      await api.patch(`/montagem-sp/${editingId}`, {
        workDate: editForm.workDate,
        startTime: editForm.startTime || null,
        endTime: editForm.endTime || null,
        stopsCount: editForm.stopsCount === "" ? 0 : Number(editForm.stopsCount),
        pauseMinutes: editForm.pauseMinutes === "" ? 0 : Number(editForm.pauseMinutes),
        pauseReason: editForm.pauseReason || null,
        palletsCount: editForm.palletsCount === "" ? null : Number(editForm.palletsCount),
        loadValue: editForm.loadValue === "" ? null : Number(editForm.loadValue),
        volume: editForm.volume === "" ? null : Number(editForm.volume),
        weightKg: editForm.weightKg === "" ? null : Number(editForm.weightKg),
        isoporQty: editForm.isoporQty === "" ? null : Number(editForm.isoporQty),
        hasHelper: editForm.hasHelper,
        helperName: editForm.hasHelper ? editForm.helperName : null,
        notes: editForm.notes || null
      });
      setMessage("Registro de Montagem SP atualizado.");
      cancelEdit();
      await loadList();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha ao atualizar montagem.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Montagem SP</h2>
          <p className="text-sm text-slate-600">Fluxo: Iniciar, registrar paradas, tirar a foto para finalizar o tempo e depois completar os informes ou registrar depois.</p>
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
            <p>Termino: {sessionEndIso ? formatDateTimeFromIso(sessionEndIso) : "Aguardando foto"}</p>
            <p>Status: {pauseStartIso ? "Em parada" : isRunning ? "Em andamento" : sessionEndIso ? "Finalizado por foto" : sessionStartIso ? "Aguardando foto" : "Nao iniciado"}</p>
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

        <div className="grid md:grid-cols-2 gap-3">
          <div className="flex items-end gap-2">
            <input id="montagem-photo" className="hidden" type="file" accept="image/*" capture="environment" onChange={(e) => finalizeByPhoto(e.target.files?.[0] || null)} />
            <label htmlFor="montagem-photo" className="rounded-xl border px-3 py-2 cursor-pointer whitespace-nowrap">Tirar foto da carga</label>
            <span className="text-sm text-slate-500 truncate">{photo?.name || "Nenhuma foto"}</span>
          </div>
          <div className="text-sm text-slate-600 flex items-center">A foto finaliza o contador e libera o preenchimento dos informes finais.</div>
        </div>

        {completionUnlocked && (
          <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 space-y-4">
            <h3 className="font-semibold">Informes finais da carga</h3>

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

            <label className="text-sm block">
              <span className="block mb-1 text-slate-600">Observacoes</span>
              <input className="border rounded-xl px-3 py-2 w-full" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
            </label>

            <div className="flex gap-2 flex-wrap">
              <button type="button" disabled={loading} onClick={() => persistRecord("complete")} className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold disabled:opacity-50">
                {loading ? "Salvando..." : "Registrar montagem"}
              </button>
              <button type="button" disabled={loading} onClick={() => persistRecord("later")} className="rounded-xl border border-amber-500 text-amber-700 px-5 py-2 font-semibold disabled:opacity-50">
                Registrar depois
              </button>
              <button type="button" onClick={resetForm} className="rounded-xl border border-slate-300 px-5 py-2 font-semibold">
                Limpar
              </button>
            </div>
          </div>
        )}

        <div className="text-sm text-slate-600">
          <p>Paradas: {stopsCount}</p>
          <p>Total parado: {pauseMinutes} min</p>
          {sessionEndIso ? <p>Termino: {formatDateTimeFromIso(sessionEndIso)}</p> : null}
        </div>

        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>

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
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr className="border-b">
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
                  <td>
                    <button type="button" onClick={() => startEdit(item)} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold">
                      Editar
                    </button>
                  </td>
                </tr>
                {editingId === item.id && editForm && (
                  <tr className="border-b bg-slate-50">
                    <td colSpan={12} className="p-3">
                      <div className="grid md:grid-cols-4 gap-3 mb-3">
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Data</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="date" value={editForm.workDate} onChange={(e) => setEditForm({ ...editForm, workDate: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Inicio</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Termino</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Paradas</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={editForm.stopsCount} onChange={(e) => setEditForm({ ...editForm, stopsCount: e.target.value })} />
                        </label>
                      </div>

                      <div className="grid md:grid-cols-5 gap-3 mb-3">
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Parada (min)</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={editForm.pauseMinutes} onChange={(e) => setEditForm({ ...editForm, pauseMinutes: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Qtde palete</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={editForm.palletsCount} onChange={(e) => setEditForm({ ...editForm, palletsCount: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Valor da carga</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} step="0.01" value={editForm.loadValue} onChange={(e) => setEditForm({ ...editForm, loadValue: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Volume</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={editForm.volume} onChange={(e) => setEditForm({ ...editForm, volume: e.target.value })} />
                        </label>
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Peso (kg)</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} step="0.01" value={editForm.weightKg} onChange={(e) => setEditForm({ ...editForm, weightKg: e.target.value })} />
                        </label>
                      </div>

                      <div className="grid md:grid-cols-4 gap-3 mb-3">
                        <label className="text-sm">
                          <span className="block mb-1 text-slate-600">Isopor</span>
                          <input className="border rounded-xl px-3 py-2 w-full" type="number" min={0} value={editForm.isoporQty} onChange={(e) => setEditForm({ ...editForm, isoporQty: e.target.value })} />
                        </label>
                        <label className="text-sm flex items-center gap-2 border rounded-xl px-3 py-2 h-[42px] mt-6">
                          <input type="checkbox" checked={editForm.hasHelper} onChange={(e) => setEditForm({ ...editForm, hasHelper: e.target.checked, helperName: e.target.checked ? editForm.helperName : "" })} />
                          Teve ajudante?
                        </label>
                        {editForm.hasHelper && (
                          <label className="text-sm md:col-span-2">
                            <span className="block mb-1 text-slate-600">Ajudante</span>
                            <select className="border rounded-xl px-3 py-2 w-full" value={editForm.helperName} onChange={(e) => setEditForm({ ...editForm, helperName: e.target.value })}>
                              <option value="">Selecione um usuario</option>
                              {helpers.map((helper) => (
                                <option key={helper.id} value={helper.name}>{helper.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>

                      <label className="text-sm block mb-3">
                        <span className="block mb-1 text-slate-600">Motivo / observacoes</span>
                        <input className="border rounded-xl px-3 py-2 w-full" value={editForm.pauseReason} onChange={(e) => setEditForm({ ...editForm, pauseReason: e.target.value })} placeholder="Motivo da parada" />
                        <input className="border rounded-xl px-3 py-2 w-full mt-2" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Observacoes" />
                      </label>

                      <div className="flex gap-2">
                        <button type="button" onClick={saveEdit} disabled={savingEdit} className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold disabled:opacity-50">
                          {savingEdit ? "Salvando..." : "Salvar edicao"}
                        </button>
                        <button type="button" onClick={cancelEdit} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold">
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


