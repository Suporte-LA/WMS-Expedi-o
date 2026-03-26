export type Role = "admin" | "supervisor" | "operator" | "conferente";
export type Workspace = "expedicao" | "estoque" | "estoque-ti" | "ti";

export type ScreenKey =
  | "dashboard"
  | "descents"
  | "error-check"
  | "error-reports"
  | "imports"
  | "users"
  | "montagem-sp";

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

export type WorkspaceAccessSettings = {
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: Role;
    is_active: boolean;
  }>;
  workspaces: Workspace[];
  permissions: Record<string, Record<Workspace, boolean>>;
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
  description?: string | null;
  category?: string | null;
  display_name?: string | null;
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
  movement_date?: string | null;
  guide?: string | null;
  movement_code?: string | null;
  destination_final?: string | null;
  sku?: string;
  cod?: string | null;
  description?: string | null;
  category?: string | null;
};

export type StockBaseProduct = {
  id: string;
  product_code: string;
  description: string;
  barcode?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  local?: string | null;
  street?: string | null;
  allocation_position_code?: string | null;
  allocation_position_label?: string | null;
  allocation_pallet_code?: string | null;
  created_at: string;
  updated_at: string;
};

export type StockBaseImport = {
  id: string;
  filename: string;
  processed_rows: number;
  inserted_rows: number;
  updated_rows: number;
  imported_by_name?: string | null;
  created_at: string;
};

export type StockReplenishmentRecord = {
  id: string;
  work_date: string;
  entry_time?: string | null;
  product_code?: string | null;
  description?: string | null;
  barcode?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  quantity_1?: number | null;
  expiry_1?: string | null;
  quantity_2?: number | null;
  expiry_2?: string | null;
  user_name?: string | null;
  local?: string | null;
  street?: string | null;
  created_at: string;
};

export type StockExpirationRecord = {
  id: string;
  work_date: string;
  product_code?: string | null;
  description?: string | null;
  barcode?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  quantity?: number | null;
  expiry_date?: string | null;
  user_name?: string | null;
  local?: string | null;
  street?: string | null;
  created_at: string;
};

export type StockActivityLog = {
  id: string;
  work_date: string;
  movement_type: "entry" | "exit";
  activity_type: "validade" | "abastecimento";
  product_code: string;
  description: string;
  barcode?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  local?: string | null;
  street?: string | null;
  expiry_date?: string | null;
  quantity: number;
  operator_name?: string | null;
  created_at: string;
};

export type StockDashboardResponse = {
  cards: {
    total_entries: number;
    total_exits: number;
    total_skus: number;
    total_operators: number;
  };
  trend: Array<{
    work_date: string;
    entries: number;
    exits: number;
  }>;
  byOperator: Array<{
    operator_name: string;
    total_quantity: number;
    total_activities: number;
  }>;
  byActivity: Array<{
    label: string;
    total_quantity: number;
  }>;
};

export type StockAllocationRecord = {
  id: string;
  product_code: string;
  description: string;
  barcode?: string | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  quantity: number;
  shed: string;
  street: string;
  building: string;
  apartment: string;
  pallet_position: string;
  position_code: string;
  position_label: string;
  pallet_code?: string | null;
  allocation_mode: "single" | "pallet";
  operator_name: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type StockAllocationLog = {
  id: string;
  allocation_id?: string | null;
  action_type: "create" | "update" | "move";
  product_code: string;
  description: string;
  quantity: number;
  previous_position_code?: string | null;
  previous_position_label?: string | null;
  new_position_code: string;
  new_position_label: string;
  pallet_code?: string | null;
  operator_name: string;
  notes?: string | null;
  created_at: string;
};
