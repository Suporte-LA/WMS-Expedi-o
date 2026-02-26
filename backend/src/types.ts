export type UserRole = "admin" | "supervisor" | "operator" | "conferente";

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  pen_color: string;
};
