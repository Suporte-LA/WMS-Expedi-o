import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { stockRead } from "./offline";
import { type Address, type Page } from "./types";
import { ImportFile } from "./Products";
import { messageOf } from "./helpers";
import { Field, Notice, Pagination } from "./ui";
const empty = {
  galpao: 1,
  rua: 1,
  coluna: 1,
  nivel: 1,
  posicao: 1,
  bloqueado: false,
  motivo_bloqueio: "",
};
const initialRange = {
  galpao: 1,
  rua: 1,
  coluna_de: 1,
  coluna_ate: 14,
  nivel_de: 1,
  nivel_ate: 1,
  posicao_de: 1,
  posicao_ate: 1,
};
export function Addresses({ userId }: { userId: string }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState(empty);
  const [range, setRange] = useState(initialRange);
  const [lastA, setLastA] = useState(7);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const result = useQuery({
    queryKey: ["stock", userId, "addresses", q, page],
    networkMode: "always",
    queryFn: ({ signal }) =>
      stockRead<Page<Address>>(
        userId,
        `/occupancy?q=${encodeURIComponent(q)}&page=${page}`,
        signal,
      ),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["stock"] });
  };
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function print() {
    const JsBarcode = (await import("jsbarcode")).default;
    const container = printRef.current!;
    container.replaceChildren();
    for (const row of result.data?.items.filter((r) =>
      selected.includes(r.id),
    ) || []) {
      const label = document.createElement("article");
      label.className = "stock-label";
      const name = document.createElement("p");
      name.textContent = `Galpão ${row.galpao} · ${row.local} · Nível ${row.nivel}`;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, row.codigo, {
        format: "CODE128",
        width: 2,
        height: 55,
        displayValue: true,
        fontSize: 20,
      });
      label.append(name, svg);
      container.append(label);
    }
    window.print();
  }
  return (
    <div className="stock-stack">
      <div className="stock-card stock-row">
        <Field label="Buscar endereço">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
              setSelected([]);
            }}
            placeholder="Código de 9 dígitos"
          />
        </Field>
        <button
          className="stock-primary"
          onClick={() => {
            setEditing(null);
            setDraft(empty);
          }}
        >
          Novo endereço
        </button>
        <button
          disabled={!selected.length}
          onClick={() => void print().catch((e) => setError(messageOf(e)))}
        >
          Imprimir etiquetas ({selected.length})
        </button>
      </div>
      <Notice
        error
        message={error || (result.error ? messageOf(result.error) : "")}
      />
      <Notice message={notice} />
      {editing !== undefined && (
        <div className="stock-card stock-stack">
          <h2>{editing ? "Editar endereço" : "Novo endereço"}</h2>
          <div className="stock-fields">
            {(
              [
                ["galpao", "Galpão"],
                ["rua", "Rua"],
                ["coluna", "Coluna"],
                ["nivel", "Nível"],
                ["posicao", "Posição"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min={key === "nivel" ? 0 : 1}
                  max={key === "galpao" ? 9 : 99}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))
                  }
                />
              </Field>
            ))}
          </div>
          <label className="stock-check">
            <input
              type="checkbox"
              checked={draft.bloqueado}
              onChange={(e) =>
                setDraft((d) => ({ ...d, bloqueado: e.target.checked }))
              }
            />{" "}
            Bloqueado
          </label>
          <Field label="Motivo do bloqueio">
            <input
              value={draft.motivo_bloqueio}
              onChange={(e) =>
                setDraft((d) => ({ ...d, motivo_bloqueio: e.target.value }))
              }
            />
          </Field>
          <p className="stock-muted">
            Código e local serão derivados das coordenadas. Endereços com
            histórico não podem mudar de código.
          </p>
          <div className="stock-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (editing)
                    await api.put(`/stock/addresses/${editing}`, draft);
                  else await api.post("/stock/addresses", draft);
                  setEditing(undefined);
                  setNotice("Endereço salvo.");
                })
              }
            >
              Salvar endereço
            </button>
            <button onClick={() => setEditing(undefined)}>Cancelar</button>
          </div>
        </div>
      )}
      <details className="stock-card">
        <summary>Gerar endereços em lote e configurar lado da rua</summary>
        <div className="stock-fields">
          {(Object.keys(initialRange) as (keyof typeof initialRange)[]).map(
            (key) => (
              <Field key={key} label={key.replaceAll("_", " ")}>
                <input
                  type="number"
                  min={key.startsWith("nivel") ? 0 : 1}
                  max={key === "galpao" ? 9 : 99}
                  value={range[key]}
                  onChange={(e) =>
                    setRange((r) => ({ ...r, [key]: Number(e.target.value) }))
                  }
                />
              </Field>
            ),
          )}
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const { data } = await api.post(
                "/stock/addresses/generate",
                range,
              );
              setNotice(
                `${data.inserted} posições criadas; ${data.existentes} já existiam.`,
              );
            })
          }
        >
          Gerar posições
        </button>
        <div className="stock-fields">
          <Field label="Última coluna do lado A (demais = B)">
            <input
              type="number"
              min="1"
              max="99"
              value={lastA}
              onChange={(e) => setLastA(Number(e.target.value))}
            />
          </Field>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.put("/stock/streets", {
                  galpao: range.galpao,
                  rua: range.rua,
                  last_column_a: lastA,
                });
                setNotice("Regra de lado da rua atualizada.");
              })
            }
          >
            Salvar regra da rua acima
          </button>
        </div>
      </details>
      <ImportFile path="/stock/addresses/import" onDone={refresh} />
      <div className="stock-card stock-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th>Endereço</th>
              <th>Local</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.items.map((a) => (
              <tr key={a.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Etiqueta ${a.codigo}`}
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, a.id]
                          : ids.filter((id) => id !== a.id),
                      )
                    }
                  />
                </td>
                <td>{a.codigo}</td>
                <td>
                  Galpão {a.galpao} · {a.local}
                </td>
                <td>{a.status}</td>
                <td>
                  <button
                    onClick={() => {
                      setEditing(a.id);
                      setDraft({
                        ...a,
                        motivo_bloqueio: a.motivo_bloqueio || "",
                      });
                    }}
                  >
                    Editar / bloquear
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Excluir ${a.codigo}? Endereços com histórico serão preservados.`,
                        )
                      )
                        void run(() => api.delete(`/stock/addresses/${a.id}`));
                    }}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total={result.data?.total || 0}
        onChange={(p) => {
          setPage(p);
          setSelected([]);
        }}
      />
      <div id="stock-print" ref={printRef} />
    </div>
  );
}
