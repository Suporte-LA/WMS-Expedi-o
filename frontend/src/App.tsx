import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { clearAuth, getStoredUser, getToken } from "./lib/auth";
import type { Role, User } from "./types";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportsPage } from "./pages/ImportsPage";
import { UsersPage } from "./pages/UsersPage";
import { DescentsPage } from "./pages/DescentsPage";
import { ErrorCheckPage } from "./pages/ErrorCheckPage";
import { ErrorReportsPage } from "./pages/ErrorReportsPage";

type AppRoute = "/" | "/descents" | "/error-check" | "/error-reports" | "/imports" | "/users";

type NavItem = { to: AppRoute; label: string };

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    { to: "/", label: "Dashboard" },
    { to: "/descents", label: "Descer Pedidos" },
    { to: "/error-check", label: "Conferencia Erros" },
    { to: "/error-reports", label: "Relatorio Erros" },
    { to: "/imports", label: "Imports" },
    { to: "/users", label: "Usuarios" }
  ],
  supervisor: [
    { to: "/", label: "Dashboard" },
    { to: "/descents", label: "Descer Pedidos" },
    { to: "/error-check", label: "Conferencia Erros" },
    { to: "/error-reports", label: "Relatorio Erros" },
    { to: "/users", label: "Usuarios" }
  ],
  operator: [{ to: "/descents", label: "Descer Pedidos" }],
  conferente: [{ to: "/error-check", label: "Conferencia Erros" }]
};

function defaultRouteFor(role: Role): AppRoute {
  return NAV_BY_ROLE[role][0].to;
}

function canAccess(role: Role, path: AppRoute): boolean {
  return NAV_BY_ROLE[role].some((item) => item.to === path);
}

function ProtectedLayout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const location = useLocation();
  const nav = useMemo(() => NAV_BY_ROLE[user.role], [user.role]);
  const defaultRoute = defaultRouteFor(user.role);

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
        <Routes>
          <Route
            path="/"
            element={canAccess(user.role, "/") ? <DashboardPage /> : <Navigate to={defaultRoute} replace />}
          />
          <Route
            path="/descents"
            element={canAccess(user.role, "/descents") ? <DescentsPage user={user} /> : <Navigate to={defaultRoute} replace />}
          />
          <Route
            path="/error-check"
            element={canAccess(user.role, "/error-check") ? <ErrorCheckPage user={user} /> : <Navigate to={defaultRoute} replace />}
          />
          <Route
            path="/error-reports"
            element={canAccess(user.role, "/error-reports") ? <ErrorReportsPage /> : <Navigate to={defaultRoute} replace />}
          />
          <Route
            path="/imports"
            element={canAccess(user.role, "/imports") ? <ImportsPage user={user} /> : <Navigate to={defaultRoute} replace />}
          />
          <Route
            path="/users"
            element={canAccess(user.role, "/users") ? <UsersPage currentUser={user} /> : <Navigate to={defaultRoute} replace />}
          />
          <Route path="*" element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [checking, setChecking] = useState(true);

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
      } catch {
        clearAuth();
        setUser(null);
      } finally {
        setChecking(false);
      }
    }
    validateSession();
  }, []);

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

  return <ProtectedLayout user={user} onLogout={logout} />;
}
