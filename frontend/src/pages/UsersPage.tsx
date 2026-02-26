import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { Role, User } from "../types";

export function UsersPage({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [penColor, setPenColor] = useState("Blue");
  const [error, setError] = useState("");
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});

  const isAdmin = currentUser.role === "admin";

  async function loadUsers() {
    if (!isAdmin) return;
    const { data } = await api.get("/users");
    const items = (data.items || []) as User[];
    setUsers(items);
    const drafts: Record<string, Role> = {};
    items.forEach((u) => {
      drafts[u.id] = u.role;
    });
    setRoleDrafts(drafts);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) {
      setError("Nome deve ter ao menos 2 caracteres.");
      return;
    }
    if (!email.includes("@")) {
      setError("E-mail invalido.");
      return;
    }
    if (password.length < 6) {
      setError("Senha deve ter ao menos 6 caracteres.");
      return;
    }
    if (!penColor.trim()) {
      setError("Cor da caneta e obrigatoria.");
      return;
    }
    try {
      await api.post("/users", { name, email, password, role, pen_color: penColor });
      setName("");
      setEmail("");
      setPassword("");
      setRole("operator");
      setPenColor("Blue");
      await loadUsers();
    } catch (err: any) {
      const apiMessage = err?.response?.data?.message || "Erro ao criar usuario.";
      const apiErrors = err?.response?.data?.errors as Array<{ field?: string; message?: string }> | undefined;
      if (apiErrors?.length) {
        setError(`${apiMessage} ${apiErrors.map((x) => `${x.field || "campo"}: ${x.message || "invalido"}`).join(" | ")}`);
      } else {
        setError(apiMessage);
      }
    }
  }

  async function toggleActive(user: User) {
    await api.patch(`/users/${user.id}`, { is_active: !user.is_active });
    await loadUsers();
  }

  async function saveColor(user: User, color: string) {
    await api.patch(`/users/${user.id}`, { pen_color: color });
    await loadUsers();
  }

  async function saveRole(user: User) {
    const nextRole = roleDrafts[user.id];
    if (!nextRole || nextRole === user.role) return;
    await api.patch(`/users/${user.id}`, { role: nextRole });
    await loadUsers();
  }

  if (!isAdmin) {
    return <p className="text-sm text-slate-600">Somente administradores acessam esta area.</p>;
  }

  return (
    <section className="space-y-4">
      <form onSubmit={onCreate} className="bg-white rounded-2xl p-4 shadow-sm grid md:grid-cols-6 gap-3">
        <input className="border rounded-xl px-3 py-2" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="border rounded-xl px-3 py-2" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="border rounded-xl px-3 py-2"
          placeholder="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select className="border rounded-xl px-3 py-2" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="admin">admin</option>
          <option value="supervisor">supervisor</option>
          <option value="operator">operator</option>
          <option value="conferente">conferente</option>
        </select>
        <input
          className="border rounded-xl px-3 py-2"
          placeholder="Cor da caneta (ex: Green)"
          value={penColor}
          onChange={(e) => setPenColor(e.target.value)}
        />
        <button className="rounded-xl bg-teal-700 text-white font-semibold">Criar usuario</button>
        {error && <p className="text-sm text-red-700 md:col-span-6">{error}</p>}
      </form>

      <div className="bg-white rounded-2xl p-4 shadow-sm overflow-auto">
        <h2 className="font-semibold mb-3">Usuarios</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Nome</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Cor</th>
              <th>Status</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <div className="flex gap-2 items-center">
                    <select
                      className="border rounded-lg px-2 py-1"
                      value={roleDrafts[u.id] || u.role}
                      onChange={(e) =>
                        setRoleDrafts((prev) => ({ ...prev, [u.id]: e.target.value as Role }))
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="supervisor">supervisor</option>
                      <option value="operator">operator</option>
                      <option value="conferente">conferente</option>
                    </select>
                    <button className="underline text-xs" onClick={() => saveRole(u)}>
                      salvar
                    </button>
                  </div>
                </td>
                <td>
                  <div className="flex gap-2 items-center">
                    <span>{u.pen_color}</span>
                    <button className="underline text-xs" onClick={() => saveColor(u, prompt("Nova cor da caneta:", u.pen_color) || u.pen_color)}>
                      editar
                    </button>
                  </div>
                </td>
                <td>{u.is_active ? "ativo" : "inativo"}</td>
                <td>
                  <button className="underline" onClick={() => toggleActive(u)}>
                    {u.is_active ? "Desativar" : "Ativar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
