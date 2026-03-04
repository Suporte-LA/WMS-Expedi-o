import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AccessSettings, Role, ScreenKey, User, Workspace, WorkspaceAccessSettings } from "../types";

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

const WORKSPACE_LABELS: Record<Workspace, string> = {
  expedicao: "Expedicao",
  estoque: "Estoque",
  "estoque-ti": "Estoque TI"
};

export function ConfigurationsPage({ currentUser }: { currentUser: User }) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceAccessSettings | null>(null);
  const [savingScreens, setSavingScreens] = useState(false);
  const [savingWorkspaces, setSavingWorkspaces] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser.role === "admin";

  async function loadSettings() {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    try {
      const [accessRes, workspaceRes] = await Promise.all([api.get("/settings/access"), api.get("/settings/workspaces")]);
      setSettings(accessRes.data);
      setWorkspaceSettings(workspaceRes.data);
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

  function updateWorkspacePermission(userId: string, workspace: Workspace, enabled: boolean) {
    setWorkspaceSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [userId]: {
            ...(prev.permissions[userId] || { expedicao: false, estoque: false, "estoque-ti": false }),
            [workspace]: enabled
          }
        }
      };
    });
  }

  async function saveScreenSettings() {
    if (!settings) return;
    setSavingScreens(true);
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
      setMessage("Permissoes de secoes salvas com sucesso.");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao salvar configuracoes.");
    } finally {
      setSavingScreens(false);
    }
  }

  async function saveWorkspaceSettings() {
    if (!workspaceSettings) return;
    setSavingWorkspaces(true);
    setError("");
    setMessage("");
    try {
      const payload = workspaceSettings.users.flatMap((u) =>
        workspaceSettings.workspaces.map((workspace) => ({
          user_id: u.id,
          workspace,
          is_enabled: Boolean(workspaceSettings.permissions[u.id]?.[workspace])
        }))
      );
      await api.put("/settings/workspaces", { permissions: payload });
      setMessage("Permissoes de telas por usuario salvas com sucesso.");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Erro ao salvar permissoes de telas.");
    } finally {
      setSavingWorkspaces(false);
    }
  }

  if (!isAdmin) {
    return <p className="text-sm text-slate-600">Somente administradores acessam esta area.</p>;
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando configuracoes...</p>;
  }

  if (!settings || !workspaceSettings) {
    return <p className="text-sm text-red-700">{error || "Falha ao carregar configuracoes."}</p>;
  }

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Configuracoes de Secoes (Expedicao)</h2>
          <button
            type="button"
            onClick={saveScreenSettings}
            disabled={savingScreens}
            className="rounded-xl bg-teal-700 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            {savingScreens ? "Salvando..." : "Salvar secoes"}
          </button>
        </div>

        <p className="text-sm text-slate-600">Defina quais secoes da Expedicao cada perfil pode visualizar.</p>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Secao</th>
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
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Configuracoes de Telas por Usuario</h2>
          <button
            type="button"
            onClick={saveWorkspaceSettings}
            disabled={savingWorkspaces}
            className="rounded-xl bg-slate-900 text-white px-4 py-2 font-semibold disabled:opacity-50"
          >
            {savingWorkspaces ? "Salvando..." : "Salvar telas"}
          </button>
        </div>

        <p className="text-sm text-slate-600">
          Controle por usuario para Expedicao, Estoque e Estoque TI. Supervisores podem transitar entre telas liberadas aqui.
        </p>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Usuario</th>
                <th>Perfil</th>
                {workspaceSettings.workspaces.map((workspace) => (
                  <th key={workspace}>{WORKSPACE_LABELS[workspace]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspaceSettings.users.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.name}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  {workspaceSettings.workspaces.map((workspace) => (
                    <td key={`${u.id}-${workspace}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(workspaceSettings.permissions[u.id]?.[workspace])}
                        onChange={(e) => updateWorkspacePermission(u.id, workspace, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
