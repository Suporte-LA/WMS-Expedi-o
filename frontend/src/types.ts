export type Role = "admin" | "supervisor" | "operator" | "conferente";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  pen_color: string;
};

export type ImportRecord = {
  id: string;
  filename: string;
  status: "processing" | "success" | "failed";
  processed_rows: number;
  inserted_rows: number;
  updated_rows: number;
  rejected_rows: number;
  imported_at: string;
  imported_by_name?: string;
};

export type DescentRecord = {
  id: string;
  order_number: string;
  descended_by_name: string;
  pen_color: string;
  lot?: string | null;
  volume?: number | null;
  weight_kg?: number | null;
  route?: string | null;
  product_image_path?: string | null;
  work_date: string;
  created_at: string;
};

export type OrderCatalogRecord = {
  order_number: string;
  lot?: string | null;
  volume?: number | null;
  weight_kg?: number | null;
  route?: string | null;
  description?: string | null;
  base_date?: string | null;
};

export type ErrorRecord = {
  id: string;
  order_number: string;
  problem_type: string;
  finalized: boolean;
  evidence_image_path?: string | null;
  dock?: string | null;
  report_date: string;
  conferente_name: string;
  descended_user_name?: string | null;
  pen_color?: string | null;
  descended_at?: string | null;
  created_at: string;
};
