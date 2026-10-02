import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  availableAddresses,
  enqueueStock,
  resolveProduct,
  stockRead,
} from "./offline";
import { type Address, type Operation, type Product, dateBR } from "./types";
import { messageOf } from "./helpers";
import { Field, Notice, ScanInput } from "./ui";

export function AddressPicker({
  userId,
  value,
  onChange,
  preferred,
  match,
}: {
  userId: string;
  value: string;
  onChange: (id: string) => void;
  preferred?: string | null;
  match?: { productId: string; expiry: string };
}) {
  const [search, setSearch] = useState("");
  const result = useQuery({
    queryKey: ["stock", userId, "empty", search, preferred, match],
    networkMode: "always",
    queryFn: async () => {
      const rows = await availableAddresses(userId, search, match);
      if (preferred && !search && !rows.some((r) => r.id === preferred)) {
        try {
          const row = await stockRead<Address>(
            userId,
            "/addresses/" + preferred,
          );
          if (row.status === "Vazio") rows.unshift(row);
        } catch {
          /* Other positions remain selectable. */
        }
      }
      return rows;
    },
  });
  async function scan(code: string) {
    setSearch(code);
    onChange("");
    try {
      const found = (await availableAddresses(userId, code, match)).find(
        (a) => a.codigo === code,
      );
      if (found) onChange(found.id);
    } catch {
      /* Query presents the lookup error. */
    }
  }
  return (
    <div className="stock-stack">
      <ScanInput
        label="Etiqueta do endereço"
        onScan={(code) => void scan(code)}
        placeholder="9 dígitos ou deixe vazio para listar"
      />
      <Field label="Posição de destino">
        <select
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione uma posição</option>
          {result.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.codigo} · {a.local}
              {a.id === preferred ? " · Sugerido" : ""}
              {a.quantidade > 0 ? " · Mesmo produto/validade" : ""}
            </option>
          ))}
        </select>
      </Field>
      {search && (
        <button type="button" onClick={() => setSearch("")}>
          Listar posições vazias
        </button>
      )}
      <Notice
        error
        message={
          result.error
            ? messageOf(result.error)
            : result.data?.length === 0
              ? "Nenhuma posição vazia encontrada. Confira o endereço."
              : ""
        }
      />
    </div>
  );
}
export function OperationForm({
  userId,
  kind,
  row,
  onDone,
  onRegister,
}: {
  userId: string;
  kind: Operation["tipo"];
  row?: Address;
  onDone: (product?: string) => void;
  onRegister?: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(
    row?.produto_id
      ? {
          id: row.produto_id,
          codigo: row.produto_codigo!,
          descricao: row.descricao!,
          ean_unidade: row.ean_unidade!,
          ean_caixa: row.ean_caixa,
          fornecedor: "",
          qtd_na_caixa: 1,
          qtd_unitario: 1,
          peso: 0,
          endereco_padrao_id: null,
          ativo: true,
        }
      : null,
  );
  const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState(
    String(row && kind !== "SAIDA" ? row.quantidade : 1),
  );
  const [expiry, setExpiry] = useState(row?.validade || "");
  const [boxes, setBoxes] = useState(false);
  const [lot, setLot] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const entry = kind === "ENTRADA";
  const transfer = kind === "TRANSFERENCIA";
  const inventory = kind === "AJUSTE_INVENTARIO";
  const fefo = useQuery({
    queryKey: ["stock", userId, "fefo", product?.id, expiry],
    networkMode: "always",
    enabled: entry && Boolean(product) && Boolean(expiry),
    queryFn: () =>
      stockRead<{ items: Address[] }>(
        userId,
        "/occupancy?produto_id=" +
          product!.id +
          "&pageSize=1&validade_de=" +
          expiry,
      ),
  });
  const later = fefo.data?.items
    .filter((a) => a.validade && a.validade > expiry)
    .sort((a, b) => a.validade!.localeCompare(b.validade!))[0];
  async function scan(raw: string) {
    setError("");
    try {
      const found = await resolveProduct(userId, raw);
      setProduct(found);
      setBoxes(false);
      setDestination("");
    } catch (e) {
      setProduct(null);
      setError(messageOf(e));
    }
  }
  async function save() {
    setError("");
    if (
      !product ||
      !expiry ||
      !Number.isInteger(Number(quantity)) ||
      Number(quantity) < (inventory ? 0 : 1) ||
      ((entry || transfer) && !destination)
    ) {
      setError("Preencha produto, endereço, quantidade e validade.");
      return;
    }
    if (inventory && note.trim().length < 3) {
      setError("Informe o motivo da contagem.");
      return;
    }
    setSaving(true);
    try {
      await enqueueStock(userId, {
        request_id: crypto.randomUUID(),
        tipo: kind,
        produto_id: product.id,
        endereco_id: entry ? destination : row!.id,
        ...(transfer ? { destino_id: destination } : {}),
        quantidade: Number(quantity),
        validade: expiry,
        ean_lido: product.ean_lido,
        caixas: boxes,
        lote: lot,
        observacao: note,
      });
      onDone(product.id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="stock-card stock-form-width stock-stack">
      <div>
        <h2>
          {entry
            ? "Entrada de mercadoria"
            : transfer
              ? "Transferir entre posições"
              : inventory
                ? "Contagem de inventário"
                : "Saída de mercadoria"}
        </h2>
        <p className="stock-muted">
          {inventory
            ? "A diferença entre a contagem e o saldo será registrada com auditoria."
            : "O saldo será validado novamente no servidor ao confirmar."}
        </p>
      </div>
      {(entry || (inventory && !row?.produto_id)) && (
        <ScanInput label="EAN do produto" onScan={(code) => void scan(code)} />
      )}
      <Notice error message={error} />
      {!product && error && onRegister && (
        <button onClick={onRegister}>Cadastrar produto</button>
      )}
      {product && (
        <>
          <div className="stock-product-summary">
            <strong>
              {product.codigo} · {product.descricao}
            </strong>
            <p>EAN {product.ean_lido || product.ean_unidade}</p>
            {product.aviso && <Notice message={product.aviso} />}
          </div>
          {row && (
            <div className="stock-row">
              <span>
                Origem <strong>{row.codigo}</strong>
              </span>
              <span>
                Saldo consultado: <strong>{row.quantidade} un.</strong>
              </span>
            </div>
          )}
          {(entry || transfer) && (
            <AddressPicker
              userId={userId}
              value={destination}
              onChange={setDestination}
              preferred={entry ? product.endereco_padrao_id : undefined}
              match={{ productId: product.id, expiry }}
            />
          )}
          <div className="stock-fields">
            <Field
              label={
                inventory
                  ? "Quantidade contada (unidades)"
                  : boxes
                    ? "Quantidade de caixas"
                    : "Quantidade em unidades"
              }
            >
              <input
                type="number"
                inputMode="numeric"
                min={inventory ? 0 : 1}
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Validade">
              <input
                type="date"
                value={expiry}
                disabled={!entry && !(inventory && !row?.produto_id)}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
            {entry && (
              <Field label="Lote (opcional)">
                <input
                  value={lot}
                  maxLength={120}
                  onChange={(e) => setLot(e.target.value)}
                />
              </Field>
            )}
          </div>
          {entry && product.embalagem === "CAIXA" && (
            <label className="stock-check">
              <input
                type="checkbox"
                checked={boxes}
                onChange={(e) => setBoxes(e.target.checked)}
              />{" "}
              Converter caixas em unidades ({product.qtd_na_caixa} por caixa).
              Total: {Number(quantity) * (boxes ? product.qtd_na_caixa : 1)} un.
            </label>
          )}
          {entry && expiry && later && (
            <Notice
              message={`Validade inferior ao estoque (validade mais próxima já ocupada: ${dateBR(later.validade)}). Priorize a saída deste primeiro (FEFO).`}
            />
          )}
          <Field
            label={inventory ? "Motivo obrigatório" : "Observação (opcional)"}
          >
            <textarea
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="stock-actions">
            <button
              className="stock-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving
                ? "Registrando…"
                : navigator.onLine
                  ? "Confirmar movimento"
                  : "Salvar na fila offline"}
            </button>
            <button onClick={() => onDone()}>Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}
