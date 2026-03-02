import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { clearAuth, getStoredUser, getToken } from "./lib/auth";
import type { AccessSettings, Role, ScreenKey, User } from "./types";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportsPage } from "./pages/ImportsPage";
import { UsersPage } from "./pages/UsersPage";
import { DescentsPage } from "./pages/DescentsPage";
import { ErrorCheckPage } from "./pages/ErrorCheckPage";
import { ErrorReportsPage } from "./pages/ErrorReportsPage";
import { ConfigurationsPage } from "./pages/ConfigurationsPage";

type AppRoute = "/" | "/descents" | "/error-check" | "/error-reports" | "/imports" | "/users" | "/settings";

type NavItem = { to: AppRoute; label: string; screen?: ScreenKey };

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", screen: "dashboard" },
  { to: "/descents", label: "Descer Pedidos", screen: "descents" },
  { to: "/error-check", label: "Conferencia Erros", screen: "error-check" },
  { to: "/error-reports", label: "Relatorio Erros", screen: "error-reports" },
  { to: "/imports", label: "Imports", screen: "imports" },
  { to: "/users", label: "Usuarios", screen: "users" }
];

const ROUTE_TO_SCREEN: Partial<Record<AppRoute, ScreenKey>> = {
  "/": "dashboard",
  "/descents": "descents",
  "/error-check": "error-check",
  "/error-reports": "error-reports",
  "/imports": "imports",
  "/users": "users"
};

const DEFAULT_ACCESS: AccessSettings["permissions"] = {
  admin: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: true,
    users: true
  },
  supervisor: {
    dashboard: true,
    descents: true,
    "error-check": true,
    "error-reports": true,
    imports: false,
    users: true
  },
  operator: {
    dashboard: false,
    descents: true,
    "error-check": false,
    "error-reports": false,
    imports: false,
    users: false
  },
  conferente: {
    dashboard: false,
    descents: false,
    "error-check": true,
    "error-reports": false,
    imports: false,
    users: false
  }
};

function buildNav(role: Role, permissions: AccessSettings["permissions"]): NavItem[] {
  const base = NAV_ITEMS.filter((item) => (item.screen ? permissions[role][item.screen] : false));
  if (role === "admin") {
    base.push({ to: "/settings", label: "Configuracoes" });
  }
  return base;
}

function defaultRouteFor(role: Role, permissions: AccessSettings["permissions"]): AppRoute {
  const nav = buildNav(role, permissions);
  if (nav.length) return nav[0].to;
  if (role === "admin") return "/settings";
  return "/descents";
}

function canAccess(role: Role, path: AppRoute, permissions: AccessSettings["permissions"]): boolean {
  if (path === "/settings") return role === "admin";
  const screen = ROUTE_TO_SCREEN[path];
  if (!screen) return false;
  return Boolean(permissions[role][screen]);
}

function ProtectedLayout({ user, onLogout, permissions }: { user: User; onLogout: () => void; permissions: AccessSettings["permissions"] }) {
  const location = useLocation();
  const nav = useMemo(() => buildNav(user.role, permissions), [user.role, permissions]);
  const defaultRoute = defaultRouteFor(user.role, permissions);

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-4 justify-between">
          <div>
            <p className="font-bold">KPI Operacional</p>
            <p className="text-xs text-slate-300">
              {user.name} ({user.role})
            </p>
          </div>
          <nav className="flex gap-2">
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
          <button onClick={onLogout} className="text-sm underline">
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {nav.length === 0 && user.role !== "admin" ? (
          <p className="text-sm text-slate-600">Nenhuma tela liberada para este perfil no momento.</p>
        ) : (
          <Routes>
            <Route
              path="/"
              element={canAccess(user.role, "/", permissions) ? <DashboardPage /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/descents"
              element={canAccess(user.role, "/descents", permissions) ? <DescentsPage user={user} /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/error-check"
              element={canAccess(user.role, "/error-check", permissions) ? <ErrorCheckPage user={user} /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/error-reports"
              element={canAccess(user.role, "/error-reports", permissions) ? <ErrorReportsPage /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/imports"
              element={canAccess(user.role, "/imports", permissions) ? <ImportsPage user={user} /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/users"
              element={canAccess(user.role, "/users", permissions) ? <UsersPage currentUser={user} /> : <Navigate to={defaultRoute} replace />}
            />
            <Route
              path="/settings"
              element={canAccess(user.role, "/settings", permissions) ? <ConfigurationsPage currentUser={user} /> : <Navigate to={defaultRoute} replace />}
            />
            <Route path="*" element={<Navigate to={defaultRoute} replace />} />
          </Routes>
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
      } catch {
        clearAuth();
        setUser(null);
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

  return <ProtectedLayout user={user} onLogout={logout} permissions={permissions} />;
}
