import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AccessSettings, Role, ScreenKey, User } from "../types";

const SCREEN_LABELS: Record<ScreenKey, string> = {
  dashboard: "Dashboard",
  descents: "Descer Pedidos",
  "error-check": "Conferencia Erros",
  "error-reports": "Relatorio Erros",
  imports: "Imports",
  users: "Usuarios",
  "montagem-sp": "Montagem SP"
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  operator: "Operador",
  conferente: "Conferente"
};

export function ConfigurationsPage({ currentUser }: { currentUser: User }) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser.role === "admin";

  async function loadSettings() {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/settings/access");
      setSettings(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao carregar configuracoes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  function updatePermission(role: Role, screen: ScreenKey, enabled: boolean) {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [role]: {
            ...prev.permissions[role],
            [screen]: enabled
          }
        }
      };
    });
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = settings.roles.flatMap((role) =>
        settings.screens.map((screen) => ({
          role,
          screen_key: screen,
          is_enabled: Boolean(settings.permissions[role][screen])
        }))
      );
      await api.put("/settings/access", { permissions: payload });
      setMessage("Permissoes salvas com sucesso.");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao salvar configuracoes.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return <p className="text-sm text-slate-600">Somente administradores acessam esta area.</p>;
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando configuracoes...</p>;
  }

  if (!settings) {
    return <p className="text-sm text-red-700">{error || "Falha ao carregar configuracoes."}</p>;
  }

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Configuracoes de Acesso</h2>
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>

        <p className="text-sm text-slate-600">Defina quais telas cada tipo de usuario pode visualizar.</p>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Tela</th>
                {settings.roles.map((role) => (
                  <th key={role}>{ROLE_LABELS[role]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.screens.map((screen) => (
                <tr key={screen} className="border-b">
                  <td className="py-2">{SCREEN_LABELS[screen]}</td>
                  {settings.roles.map((role) => (
                    <td key={`${role}-${screen}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(settings.permissions[role][screen])}
                        onChange={(e) => updatePermission(role, screen, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </section>
  );
}
