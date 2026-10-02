import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { stockRead } from "./offline";
import { type ImportReport, type Product, type Page } from "./types";
import { AddressPicker } from "./OperationForm";
import { messageOf } from "./helpers";
import { Field, Notice, Pagination } from "./ui";
const blank = {
  codigo: "",
  descricao: "",
  ean_unidade: "",
  ean_caixa: "",
  fornecedor: "",
  qtd_unitario: 1,
  qtd_na_caixa: 1,
  peso: 0,
  endereco_padrao_id: null as string | null,
  ativo: true,
};
export function ImportFile({
  path,
  onDone,
}: {
  path: string;
  onDone: () => void;
}) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post<ImportReport>(path, body);
      setReport(data);
      onDone();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="stock-card">
      <summary>Importar CSV / XLSX</summary>
      <p className="stock-muted">
        Até 10.000 linhas. Duplicados são reportados; não substituem cadastros
        existentes.
      </p>
      <input
        aria-label="Arquivo para importar"
        type="file"
        accept=".csv,.xls,.xlsx"
        disabled={busy}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {busy && <p role="status">Importando…</p>}
      <Notice error message={error} />
      {report && (
        <>
          <p>
            {report.inserted} importados · {report.errors.length} erros
          </p>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(report, null, 2)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "relatorio-importacao.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Baixar relatório
          </button>
          <ul>
            {report.errors.slice(0, 30).map((e) => (
              <li key={e.linha}>
                Linha {e.linha}: {e.erro}
              </li>
            ))}
            {report.warnings?.slice(0, 30).map((w) => (
              <li key={w.linha}>
                Linha {w.linha}: {w.avisos.join("; ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
export function Products({ userId }: { userId: string }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const result = useQuery({
    queryKey: ["stock", userId, "products", q, page],
    networkMode: "always",
    queryFn: ({ signal }) =>
      stockRead<Page<Product>>(
        userId,
        `/products?q=${encodeURIComponent(q)}&page=${page}`,
        signal,
      ),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["stock"] });
  };
  function edit(p?: Product) {
    setEditing(p?.id || null);
    setDraft(
      p ? { ...p, peso: Number(p.peso), ean_caixa: p.ean_caixa || "" } : blank,
    );
    setError("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const { data } = editing
        ? await api.put(`/stock/products/${editing}`, draft)
        : await api.post("/stock/products", draft);
      setNotice(data.avisos?.join("; ") || "Produto salvo.");
      setEditing(undefined);
      refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stock-stack">
      <div className="stock-card stock-row">
        <Field label="Buscar produto">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Código, descrição ou EAN"
          />
        </Field>
        <button className="stock-primary" onClick={() => edit()}>
          Novo produto
        </button>
      </div>
      <Notice message={notice} />
      <Notice
        error
        message={error || (result.error ? messageOf(result.error) : "")}
      />
      {editing !== undefined && (
        <div className="stock-card stock-stack">
          <h2>{editing ? "Editar produto" : "Novo produto"}</h2>
          <div className="stock-fields">
            {(
              [
                ["codigo", "Código ERP"],
                ["descricao", "Descrição"],
                ["ean_unidade", "EAN unidade"],
                ["ean_caixa", "EAN caixa / DUN-14"],
                ["fornecedor", "Fornecedor"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [key]: e.target.value }))
                  }
                />
              </Field>
            ))}
            {(
              [
                ["qtd_unitario", "Quantidade unitária"],
                ["qtd_na_caixa", "Unidades por caixa"],
                ["peso", "Peso (kg)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min={key === "peso" ? 0 : 1}
                  step={key === "peso" ? "0.01" : "1"}
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
              checked={draft.ativo}
              onChange={(e) =>
                setDraft((d) => ({ ...d, ativo: e.target.checked }))
              }
            />{" "}
            Produto ativo
          </label>
          <details>
            <summary>Endereço padrão (opcional)</summary>
            <AddressPicker
              userId={userId}
              value={draft.endereco_padrao_id || ""}
              preferred={draft.endereco_padrao_id}
              onChange={(id) =>
                setDraft((d) => ({ ...d, endereco_padrao_id: id || null }))
              }
            />
            <button
              onClick={() =>
                setDraft((d) => ({ ...d, endereco_padrao_id: null }))
              }
            >
              Remover sugestão
            </button>
          </details>
          <div className="stock-actions">
            <button
              className="stock-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Salvar produto
            </button>
            <button onClick={() => setEditing(undefined)}>Cancelar</button>
          </div>
        </div>
      )}
      <ImportFile path="/stock/products/import" onDone={refresh} />
      <div className="stock-card stock-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código / descrição</th>
              <th>EAN unidade / caixa</th>
              <th>Fornecedor</th>
              <th>Un./caixa</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.items.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.codigo}
                  <small>{p.descricao}</small>
                </td>
                <td>
                  {p.ean_unidade}
                  <small>{p.ean_caixa || "—"}</small>
                </td>
                <td>{p.fornecedor}</td>
                <td>{p.qtd_na_caixa}</td>
                <td>{p.ativo ? "Ativo" : "Inativo"}</td>
                <td>
                  <button onClick={() => edit(p)}>Editar</button>
                  {p.ativo && (
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Inativar ${p.codigo}? O histórico será preservado.`,
                          )
                        )
                          void api
                            .delete(`/stock/products/${p.id}`)
                            .then(refresh)
                            .catch((e) => setError(messageOf(e)));
                      }}
                    >
                      Inativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        total={result.data?.total || 0}
        onChange={setPage}
      />
    </div>
  );
}
