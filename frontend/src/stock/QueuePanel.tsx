import { useState } from "react";
import { resolveQueue, type Queued } from "./offline";
import { AddressPicker } from "./OperationForm";
import { messageOf } from "./helpers";
import { Field, Notice } from "./ui";
export function QueuePanel({
  items,
  userId,
}: {
  items: Queued[];
  userId: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(
    item: Queued,
    kind: "retry" | "discard",
    change = false,
  ) {
    setBusy(true);
    setError("");
    try {
      const payload = change
        ? {
            ...item.payload,
            quantidade: quantity,
            ...(item.payload.tipo === "TRANSFERENCIA"
              ? { destino_id: address || item.payload.destino_id }
              : item.payload.tipo === "ENTRADA"
                ? { endereco_id: address || item.payload.endereco_id }
                : {}),
          }
        : undefined;
      await resolveQueue(item, kind, payload);
      setEditing(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stock-card stock-stack">
      <h2>Fila offline · {items.length} pendentes</h2>
      <p className="stock-muted">
        Os envios seguem a ordem de registro. Um conflito interrompe os
        seguintes até ser resolvido. A fila pertence ao usuário que fez os
        lançamentos.
      </p>
      <Notice error message={error} />
      {!items.length && <p>Nenhum envio pendente.</p>}
      {items.map((item) => (
        <article className="stock-queue-item" key={item.id}>
          <div className="stock-row">
            <strong>{item.payload.tipo}</strong>
            <span>{new Date(item.created).toLocaleString("pt-BR")}</span>
          </div>
          <p>
            {item.payload.quantidade ?? "—"} unidades ·{" "}
            {item.status === "conflict"
              ? "Requer conferência"
              : "Aguardando envio"}
          </p>
          <Notice error message={item.error || ""} />
          {editing === item.id && (
            <div className="stock-stack">
              <Field label="Quantidade revisada">
                <input
                  type="number"
                  min={item.payload.tipo === "AJUSTE_INVENTARIO" ? 0 : 1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </Field>
              {["ENTRADA", "TRANSFERENCIA"].includes(item.payload.tipo) && (
                <AddressPicker
                  userId={userId}
                  value={address}
                  onChange={setAddress}
                />
              )}
              <button
                disabled={busy}
                onClick={() => void action(item, "retry", true)}
              >
                Salvar correção e reenviar
              </button>
              <button onClick={() => setEditing(null)}>Cancelar edição</button>
            </div>
          )}
          <div className="stock-actions">
            <button disabled={busy} onClick={() => void action(item, "retry")}>
              Tentar novamente
            </button>
            {item.status === "conflict" && item.payload.tipo !== "ESTORNO" && (
              <button
                onClick={() => {
                  setEditing(item.id);
                  setQuantity(item.payload.quantidade || 0);
                  setAddress(
                    item.payload.destino_id || item.payload.endereco_id || "",
                  );
                }}
              >
                Corrigir dados
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Descartar este envio local? Um movimento já confirmado no servidor não será apagado.",
                  )
                )
                  void action(item, "discard");
              }}
            >
              Descartar envio
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
