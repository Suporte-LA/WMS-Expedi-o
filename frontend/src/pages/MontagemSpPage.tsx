import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, buildApiUrl } from "../lib/api";
import { buildQueueFile, flushOperationalQueue, submitQueuedOperation } from "../lib/offlineQueue";
import type { MontagemSpRecord, User } from "../types";

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

function calculateElapsedSeconds(startIso: string, endIso: string) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

export function MontagemSpPage({ user }: { user: User }) {
  const [workDate, setWorkDate] = useState(isoToday());
  const [sessionStartIso, setSessionStartIso] = useState<string | null>(null);
  const [sessionEndIso, setSessionEndIso] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

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
      const endIso = new Date().toISOString();
      setTimerSeconds(calculateElapsedSeconds(sessionStartIso, endIso));
    }, 1000);

    return () => window.clearInterval(id);
  }, [isRunning, sessionStartIso]);

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
    setPhoto(null);
  }

  function resetForm() {
    setSessionStartIso(null);
    setSessionEndIso(null);
    setTimerSeconds(0);
    setIsRunning(false);
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
    const endIso = new Date().toISOString();
    setSessionEndIso(endIso);
    setIsRunning(false);
    setTimerSeconds(calculateElapsedSeconds(sessionStartIso, endIso));
    setMessage("Foto registrada. Agora preencha os dados finais ou use Registrar depois.");
  }

  async function persistRecord(mode: "complete" | "later") {
    setMessage("");
    setError("");

    if (!sessionStartIso) {
      setError("Clique em Iniciar para marcar o horario de inicio.");
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
      const payload: Parameters<typeof submitQueuedOperation<"montagem-sp">>[1] = {
        workDate,
        loaderUserName: user.name,
        startTime: formatTimeFromDate(new Date(sessionStartIso)),
        endTime: formatTimeFromDate(new Date(sessionEndIso)),
        stopsCount: "0",
        pauseMinutes: "0",
        pauseEvents: "[]",
        hasHelper: String(hasHelper),
        helperName: hasHelper ? helperName : undefined,
        notes: notes || undefined,
        photo: buildQueueFile(photo)
      };
      if (mode === "complete") {
        if (palletsCount !== "") payload.palletsCount = String(palletsCount);
        if (loadValue !== "") payload.loadValue = String(loadValue);
        if (volume !== "") payload.volume = String(volume);
        if (weightKg !== "") payload.weightKg = String(weightKg);
        if (isoporQty !== "") payload.isoporQty = String(isoporQty);
      }

      const result = await submitQueuedOperation("montagem-sp", payload);
      if (result.status === "sent") {
        setMessage(mode === "later" ? "Montagem SP registrada sem os informes finais." : "Montagem SP registrada com sucesso.");
        await loadList();
      } else {
        setMessage("Montagem SP salva localmente e pendente de sincronizacao. Ela sera enviada automaticamente quando a conexao estabilizar.");
      }
      resetForm();
      void flushOperationalQueue();
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
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Montagem SP</h2>
          <p className="text-sm text-slate-600">Fluxo: Iniciar, tirar a foto para finalizar o tempo e depois completar os informes ou registrar depois.</p>
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
          <div className="text-sm text-slate-600 md:col-span-3">
            <p>Inicio: {sessionStartIso ? formatDateTimeFromIso(sessionStartIso) : "-"}</p>
            <p>Termino: {sessionEndIso ? formatDateTimeFromIso(sessionEndIso) : "Aguardando foto"}</p>
            <p>Status: {isRunning ? "Em andamento" : sessionEndIso ? "Finalizado por foto" : sessionStartIso ? "Aguardando foto" : "Nao iniciado"}</p>
          </div>
        </div>

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
              <th>Foto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: MontagemSpRecord) => (
              <tr className="border-b" key={item.id}>
                <td className="py-2">{item.work_date?.slice(0, 10)}</td>
                <td>{item.loader_user_name}</td>
                <td>{item.start_time || "-"}</td>
                <td>{item.end_time || "-"}</td>
                <td>{item.duration_minutes ?? "-"}</td>
                <td>{item.photo_path ? <a className="underline" href={buildApiUrl(item.photo_path)} target="_blank" rel="noreferrer">abrir</a> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
