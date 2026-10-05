-- Banco Centralx - esquema do banco de dados (PostgreSQL)
-- Todos os valores em dinheiro são guardados em CENTAVOS (BIGINT)
-- para evitar erros de arredondamento de ponto flutuante.
-- Este script pode ser rodado várias vezes (usa IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username    TEXT      NOT NULL UNIQUE,
    nome        TEXT      NOT NULL,
    email       TEXT      NOT NULL UNIQUE,
    senha_hash  TEXT      NOT NULL,
    criado_em   TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE TABLE IF NOT EXISTS contas (
    id                     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id             INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    agencia                TEXT    NOT NULL,
    numero                 TEXT    NOT NULL UNIQUE,
    saldo_centavos         BIGINT  NOT NULL DEFAULT 0 CHECK (saldo_centavos >= 0),
    poupanca_centavos      BIGINT  NOT NULL DEFAULT 0 CHECK (poupanca_centavos >= 0),
    poupanca_atualizada_em DATE    NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS chaves_pix (
    id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conta_id  INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    tipo      TEXT    NOT NULL CHECK (tipo IN ('email', 'telefone', 'cpf', 'aleatoria')),
    chave     TEXT    NOT NULL UNIQUE,
    criada_em TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE TABLE IF NOT EXISTS transacoes (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conta_origem    INTEGER REFERENCES contas(id),   -- NULL em depósitos
    conta_destino   INTEGER REFERENCES contas(id),   -- NULL em saques/pagamentos
    tipo            TEXT    NOT NULL CHECK (tipo IN (
                        'pix', 'deposito', 'saque',
                        'poupanca_guardar', 'poupanca_resgatar', 'rendimento',
                        'pagamento_fatura')),
    valor_centavos  BIGINT  NOT NULL CHECK (valor_centavos > 0),
    descricao       TEXT,
    criado_em       TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE INDEX IF NOT EXISTS idx_transacoes_origem  ON transacoes(conta_origem, criado_em);
CREATE INDEX IF NOT EXISTS idx_transacoes_destino ON transacoes(conta_destino, criado_em);

CREATE TABLE IF NOT EXISTS cartoes (
    id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conta_id            INTEGER NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
    tipo                TEXT    NOT NULL CHECK (tipo IN ('padrao', 'black')),
    numero              TEXT    NOT NULL UNIQUE,
    validade            TEXT    NOT NULL,
    cvv                 TEXT    NOT NULL,
    limite_centavos     BIGINT  CHECK (limite_centavos IS NULL OR limite_centavos > 0),  -- NULL = sem limite (Black)
    fatura_centavos     BIGINT  NOT NULL DEFAULT 0 CHECK (fatura_centavos >= 0),
    bloqueado           BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em           TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE TABLE IF NOT EXISTS compras_cartao (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cartao_id       INTEGER NOT NULL REFERENCES cartoes(id) ON DELETE CASCADE,
    estabelecimento TEXT    NOT NULL,
    valor_centavos  BIGINT  NOT NULL CHECK (valor_centavos > 0),
    criado_em       TIMESTAMP(0) NOT NULL DEFAULT LOCALTIMESTAMP(0)
);