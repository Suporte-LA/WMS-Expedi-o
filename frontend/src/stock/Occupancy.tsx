import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { stockRead } from "./offline";
import { dateBR, type Address, type Bootstrap, type Page } from "./types";
import { messageOf } from "./helpers";
import { Field, Notice, Pagination, ScanInput } from "./ui";

export function Occupancy({
  userId,
  manager,
  bootstrap,
  initialProduct,
  searchOnly = false,
  onAction,
  onHistory,
}: {
  userId: string;
  manager: boolean;
  bootstrap?: Bootstrap;
  initialProduct?: string;
  searchOnly?: boolean;
  onAction: (
    kind: "SAIDA" | "TRANSFERENCIA" | "AJUSTE_INVENTARIO",
    row: Address,
  ) => void;
  onHistory: (row: Address) => void;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({
    galpao: "",
    rua: "",
    lado: "",
    status: "",
    validade: "",
    produto_id: initialProduct || "",
  });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "30",
    ...(q ? { q } : {}),
  });
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  if (searchOnly) params.set("com_saldo", "1");
  const result = useQuery({
    networkMode: "always",
    queryKey: ["stock", userId, "occupancy", params.toString()],
    queryFn: ({ signal }) =>
      stockRead<Page<Address>>(userId, "/occupancy?" + params, signal),
  });
  function filter(key: keyof typeof filters, value: string) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }
  return (
    <div className="stock-stack">
      <div className="stock-card">
        <ScanInput
          label={
            searchOnly ? "Buscar produto · ordem FEFO" : "Produto ou endereço"
          }
          onScan={(code) => {
            setQ(code);
            setPage(1);
          }}
          placeholder="Código, EAN, endereço ou descrição"
        />
        <div className="stock-fields">
          <Field label="Galpão">
            <select
              value={filters.galpao}
              onChange={(e) => filter("galpao", e.target.value)}
            >
              <option value="">Todos</option>
              {[...new Set(bootstrap?.streets.map((s) => s.galpao))].map(
                (n) => (
                  <option key={n}>{n}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Rua">
            <select
              value={filters.rua}
              onChange={(e) => filter("rua", e.target.value)}
            >
              <option value="">Todas</option>
              {[
                ...new Set(
                  bootstrap?.streets
                    .filter(
                      (s) =>
                        !filters.galpao || String(s.galpao) === filters.galpao,
                    )
                    .map((s) => s.rua),
                ),
              ].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Lado">
            <select
              value={filters.lado}
              onChange={(e) => filter("lado", e.target.value)}
            >
              <option value="">Todos</option>
              <option>A</option>
              <option>B</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={filters.status}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">Todos</option>
              {["Vazio", "Ocupado", "Bloqueado"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Validade até">
            <input
              type="date"
              value={filters.validade}
              onChange={(e) => filter("validade", e.target.value)}
            />
          </Field>
        </div>
        {(q || filters.produto_id) && (
          <button
            onClick={() => {
              setQ("");
              filter("produto_id", "");
            }}
          >
            Limpar busca
          </button>
        )}
      </div>
      <Notice error message={result.error ? messageOf(result.error) : ""} />
      {result.isFetching && <p role="status">Consultando posições…</p>}
      <div className="stock-position-grid">
        {result.data?.items.map((row) => (
          <article
            className={`stock-position stock-${row.status.toLowerCase()}`}
            key={row.id}
          >
            <div className="stock-row">
              <strong className="stock-address-code">{row.codigo}</strong>
              <span className="stock-badge">{row.status}</span>
            </div>
            <p className="stock-muted">
              Galpão {row.galpao} · {row.local} · Nível {row.nivel}
            </p>
            <h3>
              {row.produto_codigo
                ? `${row.produto_codigo} · ${row.descricao}`
                : "Posição sem saldo"}
            </h3>
            {row.produto_id && (
              <>
                <p className="stock-muted">EAN {row.ean_unidade}</p>
                <div className="stock-row">
                  <strong>{row.quantidade} un.</strong>
                  <span>Validade {dateBR(row.validade)}</span>
                </div>
              </>
            )}
            {row.bloqueado && (
              <p className="stock-error">{row.motivo_bloqueio}</p>
            )}
            <div className="stock-actions">
              {row.produto_id && (
                <>
                  <button onClick={() => onAction("SAIDA", row)}>Saída</button>
                  <button onClick={() => onAction("TRANSFERENCIA", row)}>
                    Transferir
                  </button>
                </>
              )}
              {manager && (
                <button onClick={() => onAction("AJUSTE_INVENTARIO", row)}>
                  Inventário
                </button>
              )}
              <button onClick={() => onHistory(row)}>Histórico</button>
            </div>
          </article>
        ))}
      </div>
      {result.data && !result.data.items.length && (
        <div className="stock-card stock-empty">
          Nenhuma posição encontrada. Ajuste os filtros ou cadastre endereços.
        </div>
      )}
      <Pagination
        page={page}
        total={result.data?.total || 0}
        onChange={setPage}
      />
    </div>
  );
}
