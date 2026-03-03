import { useMemo, useState } from "react";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function StockPage() {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [userFilter, setUserFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"abastecimento" | "criticas">("abastecimento");

  const periodLabel = useMemo(() => `${from} ate ${to}`, [from, to]);

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div>
          <h2 className="font-semibold">Estoque</h2>
          <p className="text-sm text-slate-600">
            Layout inicial da tela de estoque. Aqui vamos controlar historico de abastecimento e criticas de faltantes.
          </p>
        </div>

        <div className="grid md:grid-cols-5 gap-3">
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Data inicial</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Data final</span>
            <input className="border rounded-xl px-3 py-2 w-full" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Usuario</span>
            <input
              className="border rounded-xl px-3 py-2 w-full"
              placeholder="Filtrar por usuario"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block mb-1 text-slate-600">Codigo produto</span>
            <input
              className="border rounded-xl px-3 py-2 w-full"
              placeholder="Cod produto / cod barras"
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button type="button" className="rounded-xl bg-teal-700 text-white px-5 py-2 font-semibold w-full">
              Filtrar
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <article className="rounded-xl border p-3">
            <p className="text-sm text-slate-500">Periodo</p>
            <p className="text-lg font-semibold">{periodLabel}</p>
          </article>
          <article className="rounded-xl border p-3">
            <p className="text-sm text-slate-500">Movimentos</p>
            <p className="text-lg font-semibold">-</p>
          </article>
          <article className="rounded-xl border p-3">
            <p className="text-sm text-slate-500">Volume total</p>
            <p className="text-lg font-semibold">-</p>
          </article>
          <article className="rounded-xl border p-3">
            <p className="text-sm text-slate-500">Criticas faltantes</p>
            <p className="text-lg font-semibold">-</p>
          </article>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-sm border ${activeTab === "abastecimento" ? "bg-slate-900 text-white" : "bg-white"}`}
            onClick={() => setActiveTab("abastecimento")}
          >
            Historico de Abastecimento
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-sm border ${activeTab === "criticas" ? "bg-slate-900 text-white" : "bg-white"}`}
            onClick={() => setActiveTab("criticas")}
          >
            Criticas de Faltantes
          </button>
        </div>

        {activeTab === "abastecimento" ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Data</th>
                  <th>Cod Produto</th>
                  <th>Descricao</th>
                  <th>Codigo Produto</th>
                  <th>Local</th>
                  <th>Posicao</th>
                  <th>Quantidade 1</th>
                  <th>Validade 1</th>
                  <th>Quantidade 2</th>
                  <th>Validade 2</th>
                  <th>Usuario</th>
                  <th>Hora</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-3 text-slate-500" colSpan={12}>
                    Sem dados ainda. Proximo passo sera ligar essa grade na importacao da planilha.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">Data</th>
                  <th>Codigo Produto</th>
                  <th>Descricao</th>
                  <th>Local</th>
                  <th>Local N</th>
                  <th>Quantidade</th>
                  <th>Posicao</th>
                  <th>Rua</th>
                  <th>Lote</th>
                  <th>Falta ou Quebra</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-3 text-slate-500" colSpan={10}>
                    Sem dados ainda. Proximo passo sera ligar essa grade na importacao da aba de erros.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

