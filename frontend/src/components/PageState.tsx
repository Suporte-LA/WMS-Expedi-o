export function PageState({ message = "Carregando...", error = false }: { message?: string; error?: boolean }) {
  return <div role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}
    className={`rounded-xl p-4 text-sm ${error ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-600"}`}>
    {message}
  </div>;
}
