import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { enqueueStock, stockRead } from "./offline";
import {
  type Address,
  type Bootstrap,
  type Movement,
  type Page,
  dateBR,
} from "./types";
import { download, messageOf } from "./helpers";
import { Field, Notice, Pagination } from "./ui";
export function Movements({
  userId,
  manager,
  bootstrap,
  address,
}: {
  userId: string;
  manager: boolean;
  bootstrap?: Bootstrap;
  address?: Address;
}) {
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    tipo: "",
    operador_id: "",
    produto: "",
    endereco: "",
  });
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Movement | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  if (address) params.set("endereco_id", address.id);
  const result = useQuery({
    queryKey: ["stock", userId, "movements", params.toString(), page],
    networkMode: "always",
    queryFn: ({ signal }) =>
      stockRead<Page<Movement>>(
        userId,
        `/movements?${params}&page=${page}`,
        signal,
      ),
  });
  function filter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }
  async function reverse() {
    if (!selected || reason.trim().length < 3) {
      setError("Informe o motivo do estorno.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await enqueueStock(userId, {
        request_id: crypto.randomUUID(),
        tipo: "ESTORNO",
        movimento_id: selected.id,
        observacao: reason,
      });
      setSelected(null);
      setReason("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stock-stack">
      <div className="stock-card">
        <h2>Movimentações {address ? `· ${address.codigo}` : ""}</h2>
        <p className="stock-muted">
          Histórico imutável. Correções são registradas como estornos.
        </p>
        <div className="stock-fields">
          <Field label="De">
            <input
              type="date"
              value={filters.from}
              onChange={(e) => filter("from", e.target.value)}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              value={filters.to}
              onChange={(e) => filter("to", e.target.value)}
            />
          </Field>
          <Field label="Produto (código, EAN ou descrição)">
            <input
              value={filters.produto}
              onChange={(e) => filter("produto", e.target.value)}
            />
          </Field>
          {!address && (
            <Field label="Endereço (9 dígitos)">
              <input
                inputMode="numeric"
                maxLength={9}
                onChange={(e) => {
                  if (e.target.value.length === 9 || !e.target.value)
                    filter("endereco", e.target.value);
                }}
              />
            </Field>
          )}
          <Field label="Tipo">
            <select
              value={filters.tipo}
              onChange={(e) => filter("tipo", e.target.value)}
            >
              <option value="">Todos</option>
              {[
                "ENTRADA",
                "SAIDA",
                "TRANSFERENCIA_SAIDA",
                "TRANSFERENCIA_ENTRADA",
                "AJUSTE_INVENTARIO",
                "ESTORNO",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Operador">
            <select
              value={filters.operador_id}
              onChange={(e) => filter("operador_id", e.target.value)}
            >
              <option value="">Todos</option>
              {bootstrap?.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="stock-actions">
          {["csv", "xlsx"].map((type) => (
            <button
              key={type}
              onClick={() =>
                void download(
                  `/stock/movements?${params}&export=${type}`,
                  `movimentacoes.${type}`,
                ).catch((e) => setError(messageOf(e)))
              }
            >
              Exportar {type.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <Notice
        error
        message={error || (result.error ? messageOf(result.error) : "")}
      />
      {selected && (
        <div className="stock-card stock-stack">
          <h3>
            Estornar {selected.tipo} · {selected.produto_codigo}
          </h3>
          {selected.transferencia_id && (
            <Notice message="As duas pernas desta transferência serão estornadas juntas." />
          )}
          <Field label="Motivo do estorno">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="stock-actions">
            <button disabled={busy} onClick={() => void reverse()}>
              Confirmar estorno
            </button>
            <button onClick={() => setSelected(null)}>Cancelar</button>
          </div>
        </div>
      )}
      <div className="stock-card stock-table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Data / operador",
                "Tipo",
                "Produto",
                "Endereço",
                "Validade",
                "Quantidade",
                "Observação",
                "",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data?.items.map((m) => (
              <tr key={m.id}>
                <td>
                  {new Date(m.created_at).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                  <small>{m.operador}</small>
                </td>
                <td>
                  {m.tipo}
                  {m.estornado && <small>Estornado</small>}
                </td>
                <td>
                  {m.produto_codigo}
                  <small>{m.descricao}</small>
                </td>
                <td>{m.endereco_codigo}</td>
                <td>{dateBR(m.validade)}</td>
                <td>
                  {m.sinal > 0 ? "+" : "−"}
                  {m.quantidade}
                </td>
                <td>{m.observacao || "—"}</td>
                <td>
                  {manager && !m.estornado && m.tipo !== "ESTORNO" && (
                    <button onClick={() => setSelected(m)}>Estornar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.data?.items.length === 0 && (
          <p className="stock-empty">Nenhum movimento encontrado.</p>
        )}
      </div>
      <Pagination
        page={page}
        total={result.data?.total || 0}
        onChange={setPage}
      />
    </div>
  );
}
