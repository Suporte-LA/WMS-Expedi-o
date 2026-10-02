export type Product = {
  id: string;
  codigo: string;
  descricao: string;
  ean_unidade: string;
  ean_caixa: string | null;
  fornecedor: string;
  qtd_unitario: number;
  qtd_na_caixa: number;
  peso: number;
  endereco_padrao_id: string | null;
  ativo: boolean;
  embalagem?: "UNIDADE" | "CAIXA";
  ean_lido?: string;
  aviso?: string;
};
export type Address = {
  id: string;
  codigo: string;
  galpao: number;
  rua: number;
  coluna: number;
  nivel: number;
  posicao: number;
  lado: string;
  local: string;
  bloqueado: boolean;
  motivo_bloqueio: string | null;
  status: "Vazio" | "Ocupado" | "Bloqueado";
  produto_id: string | null;
  produto_codigo: string | null;
  descricao: string | null;
  ean_unidade: string | null;
  ean_caixa: string | null;
  validade: string | null;
  quantidade: number;
};
export type Movement = {
  id: string;
  tipo: string;
  produto_id: string;
  produto_codigo: string;
  descricao: string;
  endereco_id: string;
  endereco_codigo: string;
  quantidade: number;
  sinal: number;
  validade: string;
  operador: string;
  observacao: string;
  created_at: string;
  estornado: boolean;
  transferencia_id: string | null;
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type Settings = { allow_same_expiry: boolean; strict_ean: boolean };
export type Bootstrap = {
  settings: Settings;
  streets: { galpao: number; rua: number; last_column_a: number }[];
  operators: { id: string; name: string }[];
};
export type Operation = {
  request_id: string;
  tipo: "ENTRADA" | "SAIDA" | "TRANSFERENCIA" | "AJUSTE_INVENTARIO" | "ESTORNO";
  produto_id?: string;
  endereco_id?: string;
  destino_id?: string;
  quantidade?: number;
  validade?: string;
  ean_lido?: string;
  caixas?: boolean;
  lote?: string;
  observacao?: string;
  movimento_id?: string;
};
export type ImportReport = {
  inserted: number;
  errors: { linha: number; erro: string }[];
  warnings?: { linha: number; avisos: string[] }[];
};
export function dateBR(value: string | null) {
  return value ? value.slice(0, 10).split("-").reverse().join("/") : "—";
}
