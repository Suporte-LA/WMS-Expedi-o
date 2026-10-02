-- Applied only by stock:migrate in development. Legacy stock_* tables are untouched.
CREATE TABLE wms_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  allow_same_expiry boolean NOT NULL DEFAULT false,
  strict_ean boolean NOT NULL DEFAULT false
);
INSERT INTO wms_settings DEFAULT VALUES;
CREATE TABLE wms_streets (
  galpao int NOT NULL CHECK (galpao BETWEEN 1 AND 9),
  rua int NOT NULL CHECK (rua BETWEEN 1 AND 99),
  last_column_a int NOT NULL DEFAULT 7 CHECK (last_column_a BETWEEN 1 AND 99),
  PRIMARY KEY (galpao, rua)
);
CREATE TABLE wms_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  galpao int NOT NULL,
  rua int NOT NULL,
  coluna int NOT NULL CHECK (coluna BETWEEN 1 AND 99),
  nivel int NOT NULL CHECK (nivel BETWEEN 0 AND 99),
  posicao int NOT NULL CHECK (posicao BETWEEN 1 AND 99),
  codigo text GENERATED ALWAYS AS (galpao::text || lpad(rua::text,2,'0') || lpad(coluna::text,2,'0') || lpad(nivel::text,2,'0') || lpad(posicao::text,2,'0')) STORED UNIQUE,
  bloqueado boolean NOT NULL DEFAULT false,
  motivo_bloqueio text,
  FOREIGN KEY (galpao, rua) REFERENCES wms_streets(galpao, rua),
  CHECK (NOT bloqueado OR (motivo_bloqueio IS NOT NULL AND length(trim(motivo_bloqueio)) > 0))
);
CREATE TABLE wms_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  descricao text NOT NULL,
  ean_unidade text NOT NULL,
  ean_caixa text,
  fornecedor text NOT NULL DEFAULT '',
  qtd_unitario int NOT NULL DEFAULT 1 CHECK (qtd_unitario > 0),
  qtd_na_caixa int NOT NULL DEFAULT 1 CHECK (qtd_na_caixa > 0),
  peso numeric(14,2) NOT NULL DEFAULT 0 CHECK (peso >= 0),
  endereco_padrao_id uuid REFERENCES wms_addresses(id),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One namespace for unit and box codes, including concurrent imports.
CREATE TABLE wms_product_eans (
  ean text PRIMARY KEY,
  produto_id uuid NOT NULL REFERENCES wms_products(id) ON DELETE CASCADE,
  embalagem text NOT NULL CHECK (embalagem IN ('UNIDADE','CAIXA'))
);
CREATE FUNCTION wms_sync_eans() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM wms_product_eans WHERE produto_id = NEW.id;
  INSERT INTO wms_product_eans VALUES (NEW.ean_unidade, NEW.id, 'UNIDADE');
  IF NEW.ean_caixa IS NOT NULL AND NEW.ean_caixa <> NEW.ean_unidade THEN
    INSERT INTO wms_product_eans VALUES (NEW.ean_caixa, NEW.id, 'CAIXA');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wms_product_eans_sync AFTER INSERT OR UPDATE OF ean_unidade,ean_caixa ON wms_products FOR EACH ROW EXECUTE FUNCTION wms_sync_eans();
CREATE INDEX ON wms_products(ean_unidade);
CREATE INDEX ON wms_products(ean_caixa);
CREATE TABLE wms_balances (
  endereco_id uuid NOT NULL REFERENCES wms_addresses(id),
  produto_id uuid NOT NULL REFERENCES wms_products(id),
  validade date NOT NULL,
  quantidade int NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  PRIMARY KEY (endereco_id,produto_id,validade)
);
CREATE INDEX ON wms_balances(produto_id,validade) WHERE quantidade > 0;
CREATE UNIQUE INDEX wms_one_product_expiry_per_address ON wms_balances(endereco_id) WHERE quantidade > 0;
CREATE TABLE wms_operations (
  id uuid PRIMARY KEY,
  operador_id uuid NOT NULL REFERENCES users(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wms_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('ENTRADA','SAIDA','TRANSFERENCIA_SAIDA','TRANSFERENCIA_ENTRADA','AJUSTE_INVENTARIO','ESTORNO')),
  produto_id uuid NOT NULL REFERENCES wms_products(id),
  endereco_id uuid NOT NULL REFERENCES wms_addresses(id),
  quantidade int NOT NULL CHECK (quantidade > 0),
  sinal int NOT NULL CHECK (sinal IN (-1,1)),
  validade date NOT NULL,
  lote text,
  ean_lido text,
  operador_id uuid NOT NULL REFERENCES users(id),
  observacao text,
  transferencia_id uuid,
  estorno_de_id uuid UNIQUE REFERENCES wms_movements(id),
  operation_id uuid NOT NULL REFERENCES wms_operations(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo NOT IN ('ENTRADA','TRANSFERENCIA_ENTRADA') OR sinal = 1) AND (tipo NOT IN ('SAIDA','TRANSFERENCIA_SAIDA') OR sinal = -1)),
  CHECK ((tipo = 'ESTORNO') = (estorno_de_id IS NOT NULL)),
  CHECK (tipo NOT IN ('TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SAIDA') OR transferencia_id IS NOT NULL)
);
CREATE INDEX ON wms_movements(created_at DESC);
CREATE INDEX ON wms_movements(endereco_id,created_at DESC);
CREATE INDEX ON wms_movements(produto_id,created_at DESC);
CREATE INDEX ON wms_movements(transferencia_id) WHERE transferencia_id IS NOT NULL;
CREATE TABLE wms_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operador_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity_id text,
  ip text,
  device text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION wms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Movimentos e auditoria sao imutaveis; use estorno'; END $$;
CREATE TRIGGER wms_movements_immutable BEFORE UPDATE OR DELETE ON wms_movements FOR EACH ROW EXECUTE FUNCTION wms_immutable();
CREATE TRIGGER wms_audit_immutable BEFORE UPDATE OR DELETE ON wms_audit FOR EACH ROW EXECUTE FUNCTION wms_immutable();
CREATE VIEW wms_occupancy AS
 SELECT a.*, CASE WHEN a.coluna <= r.last_column_a THEN 'A' ELSE 'B' END AS lado,
 'RUA ' || lpad(a.rua::text,2,'0') || ' ' || CASE WHEN a.coluna <= r.last_column_a THEN 'A' ELSE 'B' END AS local,
 CASE WHEN a.bloqueado THEN 'Bloqueado' WHEN b.quantidade > 0 THEN 'Ocupado' ELSE 'Vazio' END AS status,
 b.produto_id, b.validade, COALESCE(b.quantidade,0) AS quantidade,
 p.codigo AS produto_codigo,p.descricao,p.ean_unidade,p.ean_caixa
 FROM wms_addresses a JOIN wms_streets r USING(galpao,rua)
 LEFT JOIN wms_balances b ON b.endereco_id=a.id AND b.quantidade>0
 LEFT JOIN wms_products p ON p.id=b.produto_id;
