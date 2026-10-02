import { lazy, Suspense, useState } from "react";
import type { FormEvent, ReactNode } from "react";
const Scanner = lazy(() =>
  import("../components/BarcodeScannerModal").then((m) => ({
    default: m.BarcodeScannerModal,
  })),
);
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="stock-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ScanInput({
  label,
  onScan,
  placeholder = "Bipe ou digite e pressione Enter",
}: {
  label: string;
  onScan: (code: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) onScan(value.trim());
  }
  return (
    <>
      <form onSubmit={submit} className="stock-scan">
        <Field label={label}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            inputMode={label === 'EAN do produto' || label === 'Etiqueta do endereço' ? 'numeric' : 'text'}
            autoFocus
          />
        </Field>
        <button type="submit" className="stock-primary">
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setCamera(true)}
          aria-label={`Ler ${label} pela camera`}
        >
          Câmera
        </button>
      </form>
      {camera && (
        <Suspense fallback={<p role="status">Abrindo câmera…</p>}>
          <Scanner
            open
            onClose={() => setCamera(false)}
            onDetected={(code) => {
              setValue(code);
              onScan(code);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="stock-pagination">
      <span>
        {total} registros · Página {page}
      </span>
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Anterior
      </button>
      <button disabled={page * 30 >= total} onClick={() => onChange(page + 1)}>
        Próxima
      </button>
    </div>
  );
}
export function Notice({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}) {
  return message ? (
    <p
      role={error ? "alert" : "status"}
      className={error ? "stock-notice stock-error" : "stock-notice"}
    >
      {message}
    </p>
  ) : null;
}
