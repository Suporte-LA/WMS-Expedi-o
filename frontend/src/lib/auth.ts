import type { User } from "../types";

const TOKEN_KEY = "kpi_app_token";
const USER_KEY = "kpi_app_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    return {
      id: parsed.id || "",
      name: parsed.name || "",
      email: parsed.email || "",
      role: (parsed.role as User["role"]) || "operator",
      is_active: Boolean(parsed.is_active),
      pen_color: parsed.pen_color || "Blue",
      workspace: (parsed.workspace as User["workspace"]) || "expedicao"
    };
  } catch {
    return null;
  }
}
