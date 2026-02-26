import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { ImportRecord, User } from "../types";

export function ImportsPage({ user }: { user: User }) {
  const [file, setFile] = useState<File | null>(null);
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [message, setMessage] = useState("");
  const [baseMessage, setBaseMessage] = useState("");
  const [error, setError] = useState("");
  const [baseError, setBaseError] = useState("");
  const [loading, setLoading] = useState(false);
  const [baseLoading, setBaseLoading] = useState(false);
  const [kpiProgress, setKpiProgress] = useState(0);
  const [baseProgress, setBaseProgress] = useState(0);
  const [kpiStartedAt, setKpiStartedAt] = useState<number | null>(null);
  const [baseStartedAt, setBaseStartedAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const kpiTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canImport = user.role === "admin" || user.role === "supervisor";

  async function loadImports() {
    const { data } = await api.get("/imports");
    setImports(data.items || []);
  }

  useEffect(() => {
    loadImports();
  }, []);

  useEffect(() => {
    return () => {
      if (kpiTickerRef.current) clearInterval(kpiTickerRef.current);
      if (baseTickerRef.current) clearInterval(baseTickerRef.current);
      if (noticeRef.current) clearTimeout(noticeRef.current);
    };
  }, []);

  function showNotice(type: "success" | "error", text: string) {
    if (noticeRef.current) clearTimeout(noticeRef.current);
    setNotice({ type, text });
    noticeRef.current = setTimeout(() => setNotice(null), 5000);
  }

  function startTicker(kind: "kpi" | "base") {
    const setProgress = kind === "kpi" ? setKpiProgress : setBaseProgress;
    const ref = kind === "kpi" ? kpiTickerRef : baseTickerRef;
    if (ref.current) clearInterval(ref.current);
    ref.current = setInterval(() => {
      setProgress((prev) => (prev < 92 ? prev + 1 : prev));
    }, 600);
  }

  function stopTicker(kind: "kpi" | "base") {
    const ref = kind === "kpi" ? kpiTickerRef : baseTickerRef;
    if (ref.current) {
      clearInterval(ref.current);
      ref.current = null;
    }
  }

  function elapsed(startedAt: number | null) {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Selecione um arquivo CSV/XLSX antes de enviar.");
      showNotice("error", "Falha: selecione um arquivo KPI antes de importar.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    setKpiProgress(2);
    setKpiStartedAt(Date.now());
    startTicker("kpi");
    try {
      const form = new FormData();
      form.append("file", file);
      if (sheetName) form.append("sheetName", sheetName);

      const { data } = await api.post("/imports/kpi", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const pct = Math.round((evt.loaded * 100) / evt.total);
          setKpiProgress(Math.max(5, Math.min(95, pct)));
        }
      });
      stopTicker("kpi");
      setKpiProgress(100);
      setMessage(
        `Import concluido: ${data.summary.insertedRows} inseridas, ${data.summary.updatedRows} atualizadas, ${data.summary.rejectedRows} rejeitadas.`
      );
      showNotice("success", "Importacao KPI concluida com sucesso.");
      await loadImports();
    } catch (err: any) {
      stopTicker("kpi");
      setKpiProgress(0);
      const msg = err?.response?.data?.message || "Falha ao importar arquivo.";
      setError(msg);
      showNotice("error", `Falha na importacao KPI: ${msg}`);
    } finally {
      stopTicker("kpi");
      setLoading(false);
      setTimeout(() => setKpiProgress(0), 1200);
      setKpiStartedAt(null);
    }
  }

  async function onUploadBase(e: FormEvent) {
    e.preventDefault();
    if (!baseFile) {
      setBaseError("Selecione um arquivo XLSX/XLS da base antes de enviar.");
      showNotice("error", "Falha: selecione um arquivo Base antes de importar.");
      return;
    }
    setBaseLoading(true);
    setBaseError("");
    setBaseMessage("");
    setBaseProgress(2);
    setBaseStartedAt(Date.now());
    startTicker("base");
    try {
      const form = new FormData();
      form.append("file", baseFile);

      const { data } = await api.post("/imports/base", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (!evt.total) return;
          const pct = Math.round((evt.loaded * 100) / evt.total);
          setBaseProgress(Math.max(5, Math.min(95, pct)));
        }
      });
      stopTicker("base");
      setBaseProgress(100);
      setBaseMessage(
        `Base importada: ${data.summary.insertedRows} novas, ${data.summary.skippedRows || 0} ignoradas (ja existiam), ${data.summary.consolidatedDescents || 0} descidas consolidadas.`
      );
      showNotice("success", "Importacao da Base concluida com sucesso.");
      await loadImports();
    } catch (err: any) {
      stopTicker("base");
      setBaseProgress(0);
      const msg = err?.response?.data?.message || "Falha ao importar base.";
      setBaseError(msg);
      showNotice("error", `Falha na importacao da Base: ${msg}`);
    } finally {
      stopTicker("base");
      setBaseLoading(false);
      setTimeout(() => setBaseProgress(0), 1200);
      setBaseStartedAt(null);
    }
  }

  return (
    <section className="space-y-4">
      {notice && (
        <div
          className={`rounded-xl p-3 text-sm font-semibold ${
            notice.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {notice.text}
        </div>
      )}

      {canImport && (
        <>
          <form onSubmit={onUploadBase} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <h2 className="font-semibold">Importar Base de Pedidos</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setBaseFile(e.target.files?.[0] || null)} />
              <button type="submit" className="rounded-xl bg-teal-700 text-white font-semibold py-2" disabled={baseLoading}>
                {baseLoading ? "Importando base..." : "Importar Base"}
              </button>
            </div>
            <p className="text-sm text-slate-500">
              {baseFile ? `Arquivo base: ${baseFile.name}` : "Nenhum arquivo base selecionado."}
            </p>
            {(baseLoading || baseProgress > 0) && (
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-teal-700 transition-all duration-300" style={{ width: `${baseProgress}%` }} />
                </div>
                <p className="text-xs text-slate-500">
                  {baseProgress}% - {baseLoading ? `processando... ${elapsed(baseStartedAt)}s` : "concluido"}
                </p>
              </div>
            )}
            {baseMessage && <p className="text-sm text-emerald-700">{baseMessage}</p>}
            {baseError && <p className="text-sm text-red-700">{baseError}</p>}
          </form>

          <form onSubmit={onUpload} className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <h2 className="font-semibold">Importar KPI Diario</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <input
                className="border rounded-xl px-3 py-2"
                placeholder="Aba XLSX (padrao Externos)"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
              />
              <button type="submit" className="rounded-xl bg-teal-700 text-white font-semibold py-2" disabled={loading}>
                {loading ? "Importando KPI..." : "Importar KPI"}
              </button>
            </div>
            <p className="text-sm text-slate-500">
              {file ? `Arquivo KPI: ${file.name}` : "Nenhum arquivo KPI selecionado."}
            </p>
            {(loading || kpiProgress > 0) && (
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-teal-700 transition-all duration-300" style={{ width: `${kpiProgress}%` }} />
                </div>
                <p className="text-xs text-slate-500">
                  {kpiProgress}% - {loading ? `processando... ${elapsed(kpiStartedAt)}s` : "concluido"}
                </p>
              </div>
            )}
            {message && <p className="text-sm text-emerald-700">{message}</p>}
            {error && <p className="text-sm text-red-700">{error}</p>}
          </form>
        </>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
        <h2 className="font-semibold mb-3">Historico de Imports</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Arquivo</th>
              <th>Data Importacao</th>
              <th>Status</th>
              <th>Processadas</th>
              <th>Inseridas</th>
              <th>Atualizadas</th>
              <th>Rejeitadas</th>
            </tr>
          </thead>
          <tbody>
            {imports.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2">{item.filename}</td>
                <td>{item.imported_at ? new Date(item.imported_at).toLocaleString("pt-BR") : "-"}</td>
                <td>{item.status}</td>
                <td>{item.processed_rows}</td>
                <td>{item.inserted_rows}</td>
                <td>{item.updated_rows}</td>
                <td>{item.rejected_rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
