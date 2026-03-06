import { useState } from "react";

type TiSection = "registro" | "controle";

export function TiPage() {
  const [activeSection, setActiveSection] = useState<TiSection>("registro");

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold">TI</h2>
            <p className="text-sm text-slate-600">Central de TI para registrar e acompanhar aparelhos de vendas.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveSection("registro")}
              className={`rounded-lg px-3 py-1 text-sm ${activeSection === "registro" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Registro de aparelho de vendas
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("controle")}
              className={`rounded-lg px-3 py-1 text-sm ${activeSection === "controle" ? "bg-teal-700 text-white" : "bg-slate-800 text-white hover:bg-slate-700"}`}
            >
              Controle de aparelhos de vendas
            </button>
          </div>
        </div>
      </div>

      {activeSection === "registro" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px]">
          <h3 className="font-semibold">Registro de aparelho de vendas</h3>
        </div>
      )}

      {activeSection === "controle" && (
        <div className="bg-white rounded-2xl p-4 shadow-sm min-h-[200px]">
          <h3 className="font-semibold">Controle de aparelhos de vendas</h3>
        </div>
      )}
    </section>
  );
}
