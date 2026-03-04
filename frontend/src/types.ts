export type Role = "admin" | "supervisor" | "operator" | "conferente";
export type Workspace = "expedicao" | "estoque" | "estoque-ti";

export type ScreenKey = "dashboard" | "descents" | "error-check" | "error-reports" | "imports" | "users" | "montagem-sp";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  pen_color: string;
  workspace: Workspace;
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

export type AccessSettings = {
  roles: Role[];
  screens: ScreenKey[];
  permissions: Record<Role, Record<ScreenKey, boolean>>;
};

export type MontagemSpRecord = {
  id: string;
  work_date: string;
  loader_user_name: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  stops_count?: number | null;
  pause_minutes?: number | null;
  pause_reason?: string | null;
  pallets_count?: number | null;
  load_value?: number | null;
  volume?: number | null;
  weight_kg?: number | null;
  isopor_qty?: number | null;
  has_helper: boolean;
  helper_name?: string | null;
  photo_path?: string | null;
  notes?: string | null;
  created_at: string;
};

export type TiStockProduct = {
  id: string;
  sku: string;
  cod?: string | null;
  category?: string | null;
  guides?: string | null;
  current_stock: number;
  min_stock: number;
  created_at: string;
  updated_at: string;
};

export type TiStockMovement = {
  id: string;
  product_id: string;
  movement_type: "entry" | "exit" | "return";
  quantity: number;
  stock_before: number;
  stock_after: number;
  notes?: string | null;
  created_by_name: string;
  created_at: string;
  sku?: string;
  cod?: string | null;
  category?: string | null;
};
