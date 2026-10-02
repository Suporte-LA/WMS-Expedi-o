import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { PageState } from "./components/PageState";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { api } from "./lib/api";
import { clearAuth, getStoredUser, getToken } from "./lib/auth";
import { exportPendingOperations, flushOperationalQueue, getPendingOperationCount, onOperationalQueueChange, startOperationalQueueSync } from "./lib/offlineQueue";
import type { AccessSettings, Role, ScreenKey, User, Workspace } from "./types";
import { LoginPage } from "./pages/LoginPage";
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ImportsPage = lazy(() => import("./pages/ImportsPage").then((m) => ({ default: m.ImportsPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const DescentsPage = lazy(() => import("./pages/DescentsPage").then((m) => ({ default: m.DescentsPage })));
const DescentReportsPage = lazy(() => import("./pages/DescentReportsPage").then((m) => ({ default: m.DescentReportsPage })));
const ErrorCheckPage = lazy(() => import("./pages/ErrorCheckPage").then((m) => ({ default: m.ErrorCheckPage })));
const ErrorReportsPage = lazy(() => import("./pages/ErrorReportsPage").then((m) => ({ default: m.ErrorReportsPage })));
const ConfigurationsPage = lazy(() => import("./pages/ConfigurationsPage").then((m) => ({ default: m.ConfigurationsPage })));
const MontagemSpPage = lazy(() => import("./pages/MontagemSpPage").then((m) => ({ default: m.MontagemSpPage })));
const StockPage = lazy(() => import("./pages/StockPage").then((m) => ({ default: m.StockPage })));

type AppRoute =
  | "/"
  | "/descents"
  | "/descent-reports"
  | "/error-check"
  | "/error-reports"
  | "/imports"
  | "/users"
  | "/montagem-sp"
  | "/settings"
  | "/estoque";

type NavItem = { to: AppRoute; label: string; screen?: ScreenKey };

const LAST_ROUTE_KEY = "wms:lastRoute";
const LAST_WORKSPACE_KEY = "wms:lastWorkspace";

const EXPEDICAO_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", screen: "dashboard" },
  { to: "/descents", label: "Descer Pedidos", screen: "descents" },
  { to: "/descent-reports", label: "Relatorio Descidas", screen: "descents" },
  { to: "/error-check", label: "Conferencia Erros", screen: "error-check" },
  { to: "/error-reports", label: "Relatorio Erros", screen: "error-reports" },
  { to: "/montagem-sp", label: "Montagem SP", screen: "montagem-sp" },
  { to: "/imports", label: "Imports", screen: "imports" },
  { to: "/users", label: "Usuarios", screen: "users" }
];

const STOCK_NAV_ITEMS: NavItem[] = [{ to: "/estoque", label: "Estoque" }];
const ALL_WORKSPACES: Workspace[] = import.meta.env.MODE === "stock" ? ["estoque"] : ["expedicao", "estoque"];

const ROUTE_TO_SCREEN: Partial<Record<AppRoute, ScreenKey>> = {
  "/": "dashboard",
  "/descents": "descents",
  "/descent-reports": "descents",
  "/error-check": "error-check",
  "/error-reports": "error-reports",
  "/montagem-sp": "montagem-sp",
  "/imports": "imports",
  "/users": "users"
};

const DEFAULT_ACCESS: AccessSettings["permissions"] = {
  admin: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    "montagem-sp": true,
    imports: true,
    users: true
  },
  supervisor: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    "montagem-sp": true,
    imports: true,
    users: true
  },
  operator: {
    dashboard: false,
    descents: true,
    "error-check": false,
    "error-reports": false,
    "montagem-sp": true,
    imports: false,
    users: false
  },
  conferente: {
    dashboard: false,
    descents: false,
    "error-check": true,
    "error-reports": false,
    "montagem-sp": false,
    imports: false,
    users: false
  }
};

function buildNav(role: Role, permissions: AccessSettings["permissions"], workspace: Workspace): NavItem[] {
  if (workspace === "estoque") {
    return STOCK_NAV_ITEMS;
  }

  const base = EXPEDICAO_NAV_ITEMS.filter((item) => (item.screen ? permissions[role][item.screen] : false));
  if (role === "admin") {
    base.push({ to: "/settings", label: "Configuracoes" });
  }
  return base;
}

function defaultRouteFor(role: Role, permissions: AccessSettings["permissions"], workspace: Workspace): AppRoute {
  if (workspace === "estoque") return "/estoque";
  const nav = buildNav(role, permissions, workspace);
  if (nav.length) return nav[0].to;
  if (role === "admin") return "/settings";
  return "/descents";
}

function canAccessExpedicaoRoute(role: Role, path: AppRoute, permissions: AccessSettings["permissions"]): boolean {
  if (path === "/settings") return role === "admin";
  const screen = ROUTE_TO_SCREEN[path];
  if (!screen) return false;
  return Boolean(permissions[role][screen]);
}

function ProtectedLayout({ user, onLogout, permissions }: { user: User; onLogout: () => void; permissions: AccessSettings["permissions"] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const userWorkspace: Workspace = ALL_WORKSPACES.includes(user.workspace) ? user.workspace : "expedicao";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>(user.role === "admin" ? (ALL_WORKSPACES.includes("estoque") && (import.meta.env.MODE === "stock" || location.pathname === "/estoque") ? "estoque" : "expedicao") : userWorkspace);
  const [allowedWorkspaces, setAllowedWorkspaces] = useState<Workspace[]>(user.role === "admin" ? ALL_WORKSPACES : ALL_WORKSPACES.filter((w) => w === user.workspace));

  useEffect(() => {
    async function loadMyWorkspaces() {
      try {
        const { data } = await api.get("/settings/workspaces/me");
        const list = Array.isArray(data?.workspaces) ? (data.workspaces as Workspace[]) : [];
        const sanitized = list.filter((w) => ALL_WORKSPACES.includes(w));
        setAllowedWorkspaces(sanitized);
        localStorage.setItem(`wms:allowedWorkspaces:${user.id}`,JSON.stringify(sanitized));
      } catch {
        try {const saved=JSON.parse(localStorage.getItem(`wms:allowedWorkspaces:${user.id}`) || 'null');setAllowedWorkspaces(Array.isArray(saved) ? saved.filter((w:Workspace)=>ALL_WORKSPACES.includes(w)) : ALL_WORKSPACES.filter((w)=>w===user.workspace));}
        catch {setAllowedWorkspaces(ALL_WORKSPACES.filter((w)=>w===user.workspace));}
      }
    }
    loadMyWorkspaces();
  }, [user.id, user.role, user.workspace]);

  useEffect(() => {
    if (!allowedWorkspaces.includes(activeWorkspace)) {
      setActiveWorkspace(allowedWorkspaces[0] || userWorkspace);
    }
  }, [user.role, userWorkspace, activeWorkspace, allowedWorkspaces]);

  const nav = useMemo(() => buildNav(user.role, permissions, activeWorkspace), [user.role, permissions, activeWorkspace]);
  const defaultRoute = defaultRouteFor(user.role, permissions, activeWorkspace);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const canSwitchWorkspace = allowedWorkspaces.length > 1;
  const workspaceOptions = allowedWorkspaces;

  useEffect(() => {
    const inStockPath = location.pathname === "/estoque";

    if (activeWorkspace === "estoque" && !inStockPath) {
      navigate("/estoque", { replace: true });
      return;
    }
    if (activeWorkspace === "expedicao" && inStockPath) {
      navigate(defaultRouteFor(user.role, permissions, "expedicao"), { replace: true });
    }
  }, [activeWorkspace, location.pathname, navigate, user.role, permissions]);

  useEffect(() => {
    if (location.pathname === "/login") return;
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname);
    localStorage.setItem(LAST_WORKSPACE_KEY, activeWorkspace);
  }, [location.pathname, activeWorkspace]);

  useEffect(() => {
    if (location.pathname !== "/") return;
    const storedRoute = localStorage.getItem(LAST_ROUTE_KEY) as AppRoute | null;
    const storedWorkspace = localStorage.getItem(LAST_WORKSPACE_KEY) as Workspace | null;
    if (!storedRoute || !storedWorkspace) return;

    if (storedWorkspace !== activeWorkspace) {
      if (canSwitchWorkspace && workspaceOptions.includes(storedWorkspace)) {
        setActiveWorkspace(storedWorkspace);
      }
      return;
    }

    if (storedWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, storedRoute, permissions)) {
      navigate(storedRoute, { replace: true });
      return;
    }
    if (storedWorkspace === "estoque" && storedRoute === "/estoque") {
      navigate("/estoque", { replace: true });
      return;
    }
  }, [location.pathname, activeWorkspace, canSwitchWorkspace, workspaceOptions, navigate, permissions, user.role]);

  if (!allowedWorkspaces.length) {
    return <main className="p-6 space-y-4">
      <p>O modulo vinculado ao seu usuario nao esta disponivel neste sistema. Solicite ao administrador a revisao do seu acesso.</p>
      <button type="button" onClick={onLogout} className="underline">Sair</button>
    </main>;
  }

  return (
    <div className="min-h-screen">
      <header className="app-header !bg-slate-900 !text-white" style={{ backgroundColor: "#0f172a", color: "#ffffff" }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">KPI Operacional</p>
            <p className="text-xs text-slate-300">
              {user.name} ({user.role})
            </p>
          </div>
          <nav className="hidden md:flex gap-2">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`px-3 py-1 rounded-lg text-sm ${
                  location.pathname === item.to ? "bg-teal-700" : "bg-slate-800 hover:bg-slate-700"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:flex items-center gap-3">
            {user.role === "admin" && (
              <select
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-sm"
                value={activeWorkspace}
                onChange={(e) => setActiveWorkspace(e.target.value as Workspace)}
              >
                {workspaceOptions.map((workspace) => (
                  <option key={workspace} value={workspace}>
                    Tela: {workspace === "expedicao" ? "Expedicao" : "Estoque"}
                  </option>
                ))}
              </select>
            )}
            {user.role !== "admin" && canSwitchWorkspace && (
              <select
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-sm"
                value={activeWorkspace}
                onChange={(e) => setActiveWorkspace(e.target.value as Workspace)}
              >
                {workspaceOptions.map((workspace) => (
                  <option key={workspace} value={workspace}>
                    Tela: {workspace === "expedicao" ? "Expedicao" : "Estoque"}
                  </option>
                ))}
              </select>
            )}
            <button onClick={onLogout} className="text-sm underline">
              Sair
            </button>
          </div>
          <button
            type="button"
            className="md:hidden rounded-lg border border-slate-600 px-3 py-1 text-sm"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
          >
            Menu
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <aside
            className="absolute left-0 top-0 h-full w-72 bg-slate-900 text-white p-4 space-y-4 shadow-xl"
            style={{ backgroundColor: "#0f172a", color: "#ffffff" }}
          >
            <div className="flex items-center justify-between">
              <p className="font-bold">Menu</p>
              <button type="button" className="rounded border border-slate-600 px-2 py-1 text-xs" onClick={() => setMobileMenuOpen(false)}>
                Fechar
              </button>
            </div>
            {canSwitchWorkspace && (
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                value={activeWorkspace}
                onChange={(e) => setActiveWorkspace(e.target.value as Workspace)}
              >
                {workspaceOptions.map((workspace) => (
                  <option key={workspace} value={workspace}>
                    Tela: {workspace === "expedicao" ? "Expedicao" : "Estoque"}
                  </option>
                ))}
              </select>
            )}
            <div className="space-y-2">
              {nav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`block rounded-lg px-3 py-2 text-sm ${
                    location.pathname === item.to ? "bg-teal-700" : "bg-slate-800"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            <button onClick={onLogout} className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm text-left">
              Sair
            </button>
          </aside>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-4">
        {nav.length === 0 && user.role !== "admin" ? (
          <p className="text-sm text-slate-600">Nenhuma tela liberada para este perfil no momento.</p>
        ) : (
          <RouteErrorBoundary key={location.pathname}><Suspense fallback={<PageState />}><Routes>
            <Route path="/estoque" element={allowedWorkspaces.includes('estoque') && activeWorkspace === "estoque" ? <Suspense fallback={<p>Carregando estoque...</p>}><StockPage user={user} /></Suspense> : <Navigate to={defaultRoute} replace />} />
            <Route
              path="/"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/", permissions)
                  ? <DashboardPage />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/descents"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/descents", permissions)
                  ? <DescentsPage user={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/descent-reports"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/descent-reports", permissions)
                  ? <DescentReportsPage user={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/error-check"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/error-check", permissions)
                  ? <ErrorCheckPage user={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/error-reports"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/error-reports", permissions)
                  ? <ErrorReportsPage />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/montagem-sp"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/montagem-sp", permissions)
                  ? <MontagemSpPage user={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/imports"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/imports", permissions)
                  ? <ImportsPage user={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/users"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/users", permissions)
                  ? <UsersPage currentUser={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route
              path="/settings"
              element={
                activeWorkspace === "expedicao" && canAccessExpedicaoRoute(user.role, "/settings", permissions)
                  ? <ConfigurationsPage currentUser={user} />
                  : <Navigate to={defaultRoute} replace />
              }
            />
            <Route path="*" element={<Navigate to={defaultRoute} replace />} />
          </Routes></Suspense></RouteErrorBoundary>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [checking, setChecking] = useState(true);
  const [permissions, setPermissions] = useState<AccessSettings["permissions"]>(DEFAULT_ACCESS);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [queueSyncing, setQueueSyncing] = useState(false);
  const [queueSyncMessage, setQueueSyncMessage] = useState("");

  useEffect(() => {
    startOperationalQueueSync();
  }, []);

  useEffect(() => {
    async function refreshPendingCount() {
      const total = await getPendingOperationCount();
      setPendingQueueCount(total);
    }
    void refreshPendingCount();
    return onOperationalQueueChange(() => {
      void refreshPendingCount();
    });
  }, []);

  useEffect(() => {
    async function validateSession() {
      const token = getToken();
      if (!token) {
        setChecking(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me");
        setUser(data.user);
        try {
          const settings = await api.get("/settings/access");
          if (settings.data?.permissions) {
            setPermissions(settings.data.permissions);
          }
        } catch {
          setPermissions(DEFAULT_ACCESS);
        }
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          clearAuth();
          setUser(null);
        }
      } finally {
        setChecking(false);
      }
    }
    validateSession();
  }, []);

  useEffect(() => {
    async function loadPermissions() {
      if (!user || !getToken()) return;
      try {
        const settings = await api.get("/settings/access");
        if (settings.data?.permissions) {
          setPermissions(settings.data.permissions);
        }
      } catch {
        setPermissions(DEFAULT_ACCESS);
      }
    }
    loadPermissions();
  }, [user?.id]);

  useEffect(() => {
    if (!user || !getToken()) return;
    void flushOperationalQueue();
  }, [user?.id]);

  async function syncPendingQueueNow() {
    setQueueSyncing(true);
    setQueueSyncMessage("");
    try {
      const result = await flushOperationalQueue();
      const total = await getPendingOperationCount();
      setPendingQueueCount(total);
      if (result) {
        const processed = result.sent + result.alreadyRecorded;
        setQueueSyncMessage(
          processed > 0
            ? `${processed} envio(s) resolvido(s). ${total} ainda pendente(s).`
            : `Nenhum envio concluido. ${result.firstError || "Verifique a conexao e tente novamente."}`
        );
      }
    } finally {
      setQueueSyncing(false);
    }
  }

  async function exportPendingQueueNow() {
    const blob = await exportPendingOperations();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fila-operacional-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  function logout() {
    clearAuth();
    setUser(null);
    navigate("/login");
  }

  if (checking) {
    return <main className="p-6 text-sm text-slate-500">Validando sessao...</main>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={setUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {pendingQueueCount > 0 && (
        <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-50">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-amber-900">
              Voce tem <strong>{pendingQueueCount}</strong> envio{pendingQueueCount > 1 ? "s" : ""} pendente{pendingQueueCount > 1 ? "s" : ""}. Eles ficam salvos localmente e serao reenviados automaticamente.
              </div>
              {queueSyncMessage && <div className="mt-1 text-xs font-medium text-amber-800">{queueSyncMessage}</div>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={syncPendingQueueNow}
                disabled={queueSyncing}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {queueSyncing ? "Sincronizando..." : "Tentar enviar agora"}
              </button>
              <button
                type="button"
                onClick={exportPendingQueueNow}
                className="rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-700"
              >
                Exportar dados pendentes
              </button>
            </div>
          </div>
        </div>
      )}
      <ProtectedLayout user={user} onLogout={logout} permissions={permissions} />
    </>
  );
}
