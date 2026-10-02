import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { stockRead } from "./offline";
import type { Settings } from "./types";
import { dateBR } from "./types";
import { messageOf } from "./helpers";
import { Notice } from "./ui";
type Metrics = {
  total: number;
  vazias: number;
  ocupadas: number;
  bloqueadas: number;
};
type DashboardData = {
  totals: Metrics;
  streets: (Metrics & {
    galpao: number;
    rua: number;
    percentual_vazias: string;
  })[];
  expiry: {
    id: string;
    codigo: string;
    descricao: string;
    quantidade: number;
    faixa: string;
    validade: string;
  }[];
};
export function Dashboard({
  userId,
  manager,
  settings,
}: {
  userId: string;
  manager: boolean;
  settings?: Settings;
}) {
  const result = useQuery({
    queryKey: ["stock", userId, "dashboard"],
    networkMode: "always",
    queryFn: ({ signal }) =>
      stockRead<DashboardData>(userId, "/dashboard", signal),
  });
  const [error, setError] = useState("");
  const [checks, setChecks] = useState<
    | {
        endereco_id: string;
        produto_id: string;
        validade: string;
        saldo: number;
        ledger: string;
      }[]
    | null
  >(null);
  const [checking, setChecking] = useState(false);
  async function reconcile() {
    setChecking(true);
    setError("");
    try {
      setChecks((await api.get("/stock/reconciliation")).data.divergencias);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setChecking(false);
    }
  }
  async function setting(key: keyof Settings, value: boolean) {
    try {
      await api.put("/stock/settings", { ...settings, [key]: value });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <div className="stock-stack">
      <Notice
        error
        message={error || (result.error ? messageOf(result.error) : "")}
      />
      <div className="stock-metrics">
        {(
          [
            ["total", "Posições totais"],
            ["ocupadas", "Ocupadas"],
            ["vazias", "Vazias"],
            ["bloqueadas", "Bloqueadas"],
          ] as const
        ).map(([key, label]) => (
          <div className="stock-card" key={key}>
            <span className="stock-muted">{label}</span>
            <strong>{result.data?.totals[key] || 0}</strong>
          </div>
        ))}
      </div>
      <div className="stock-card">
        <h2>Disponibilidade por rua</h2>
        <p className="stock-muted">
          Total:{" "}
          {result.data?.totals.total
            ? (
                (100 * result.data.totals.vazias) /
                result.data.totals.total
              ).toFixed(1)
            : "0,0"}
          % das posições estão vazias.
        </p>
        <div className="stock-streets">
          {result.data?.streets.map((r) => (
            <div key={`${r.galpao}-${r.rua}`}>
              <div className="stock-row">
                <span>
                  Galpão {r.galpao} · Rua {String(r.rua).padStart(2, "0")}
                </span>
                <strong>{r.percentual_vazias}% vazias</strong>
              </div>
              <progress max={r.total} value={r.vazias} />
              <p className="stock-muted">
                {r.ocupadas} ocupadas · {r.vazias} vazias · {r.bloqueadas}{" "}
                bloqueadas · {r.total} total
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="stock-card stock-table-wrap">
        <h2>Validades · 30 / 60 / 90 dias</h2>
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Faixa</th>
              <th>Validade mais próxima</th>
              <th>Unidades</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.expiry.map((p) => (
              <tr key={p.id + p.faixa}>
                <td>
                  {p.codigo} · {p.descricao}
                </td>
                <td>{p.faixa}</td>
                <td>{dateBR(p.validade)}</td>
                <td>{p.quantidade}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.data?.expiry.length === 0 && (
          <p>Nenhum saldo vencido ou vencendo nos próximos 90 dias.</p>
        )}
      </div>
      {manager && (
        <>
          <div className="stock-card stock-stack">
            <h2>Conferência de saldos</h2>
            <p className="stock-muted">
              Compara os saldos atuais com o histórico somente quando
              solicitado.
            </p>
            <button disabled={checking} onClick={() => void reconcile()}>
              {checking ? "Conferindo…" : "Conferir divergências"}
            </button>
            {checks && (
              <Notice message={`${checks.length} divergências encontradas.`} />
            )}
            <ul>
              {checks?.map((c) => (
                <li key={c.endereco_id + c.produto_id + c.validade}>
                  Endereço {c.endereco_id} · saldo {c.saldo} · histórico{" "}
                  {c.ledger} · {dateBR(c.validade)}
                </li>
              ))}
            </ul>
          </div>
          <div className="stock-card stock-stack">
            <h2>Regras de operação</h2>
            <label className="stock-check">
              <input
                type="checkbox"
                checked={settings?.allow_same_expiry || false}
                disabled={!settings}
                onChange={(e) =>
                  void setting("allow_same_expiry", e.target.checked)
                }
              />{" "}
              Permitir entrada adicional do mesmo produto e mesma validade
            </label>
            <label className="stock-check">
              <input
                type="checkbox"
                checked={settings?.strict_ean || false}
                disabled={!settings}
                onChange={(e) => void setting("strict_ean", e.target.checked)}
              />{" "}
              Bloquear cadastro de EAN com dígito verificador inválido
              (desmarcado: apenas aviso)
            </label>
          </div>
        </>
      )}
    </div>
  );
}
