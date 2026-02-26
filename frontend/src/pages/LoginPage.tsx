import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { setAuth } from "../lib/auth";
import type { User } from "../types";

export function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuth(data.token, data.user as User);
      onLogin(data.user as User);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Falha no login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-4">
      <section className="w-full max-w-md rounded-2xl bg-white shadow-lg p-8">
        <h1 className="text-2xl font-bold mb-2">KPI Operacional</h1>
        <p className="text-slate-500 mb-6">Entre para acessar dashboards e importacoes.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-slate-600">E-mail</span>
            <input
              className="mt-1 w-full border rounded-xl px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-600">Senha</span>
            <input
              className="mt-1 w-full border rounded-xl px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-teal-700 text-white py-2 font-semibold disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
