"""
Banco Centralx - back-end (back.py: Flask + PostgreSQL)

Banco digital FICTÍCIO feito para trabalho escolar.

Regras principais:

* valores de entrada da API são em reais (ex.: "1234,56");
  valores de saída em CENTAVOS (int)

* toda operação que mexe em dinheiro roda dentro de uma transação SQL
  (tudo ou nada)

* contas envolvidas numa operação são travadas
  (SELECT ... FOR UPDATE) para evitar que duas operações simultâneas
  gastem o mesmo saldo

* senhas são guardadas como hash (nunca em texto puro)

Estrutura:

Banco/
    Back-end/
        back.py
        schema.sql
        teste_api.py

    entrada/
        entrada.html
        entrada.css
        entrada.js

    home/
        index.html
        style.css
        script.js

    imagens/
        logos e imagens

O site abre em:

http://127.0.0.1:5000/

A rota / leva para:

/entrada/entrada.html
"""


import os
import re
import secrets
import sys
import uuid

from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
from functools import wraps

import psycopg

from psycopg.rows import dict_row

from flask import (
    Flask,
    abort,
    g,
    jsonify,
    redirect,
    request,
    send_from_directory,
    session,
)

from werkzeug.exceptions import NotFound
from werkzeug.security import check_password_hash, generate_password_hash


# ============================================================================
# CAMINHOS
# ============================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(BASE_DIR)


# ============================================================================
# REGRAS DE NEGÓCIO
# ============================================================================

AGENCIA = "0001"

LIMITE_INICIAL = 1_000_00

TETO_LIMITE_PADRAO = 50_000_00

MULTIPLO_PATRIMONIO = 3

BLACK_PATRIMONIO_MINIMO = 10_000_000_00

RENDIMENTO_DIARIO = Decimal("0.0003")

VALOR_MAXIMO = 100_000_000_00

MAX_CHAVES_PIX = 5


# ============================================================================
# FLASK
# ============================================================================

app = Flask(__name__, static_folder=None)

app.secret_key = os.environ.get("BCX_SECRET") or secrets.token_hex(32)

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


# Formato de data/hora enviado ao front-end
TS = "'YYYY-MM-DD HH24:MI:SS'"


# ============================================================================
# BANCO DE DADOS
# ============================================================================

class ConexaoBancoError(Exception):
    pass


def conectar():
    config = {
        "host": os.environ.get("BCX_DB_HOST", "localhost"),
        "port": int(os.environ.get("BCX_DB_PORT", "5432")),

        # Banco atualmente configurado no projeto
        "dbname": os.environ.get("BCX_DB_NAME", "BancoC"),

        "user": os.environ.get("BCX_DB_USER", "postgres"),
    }

    senha = os.environ.get("BCX_DB_PASSWORD")

    if senha:
        config["password"] = senha

    try:
        return psycopg.connect(
            **config,
            client_encoding="UTF8",
            connect_timeout=5,
            autocommit=True,
            row_factory=dict_row,
        )

    except (psycopg.OperationalError, UnicodeDecodeError) as e:
        raise ConexaoBancoError(
            "Não foi possível conectar ao PostgreSQL. "
            "Confira host, porta, usuário, senha "
            "(variável BCX_DB_PASSWORD) e se o database existe."
        ) from e


def get_db():
    if "db" not in g:
        g.db = conectar()

    return g.db


@app.teardown_appcontext
def fechar_db(_erro=None):
    db = g.pop("db", None)

    if db is not None:
        db.close()


def init_db():
    """
    Cria as tabelas, se ainda não existirem,
    usando o arquivo schema.sql.
    """

    with open(
        os.path.join(BASE_DIR, "schema.sql"),
        encoding="utf-8"
    ) as f:
        script = f.read()

    con = conectar()

    try:
        con.execute(script)
    finally:
        con.close()


@contextmanager
def transacao():
    """
    Tudo dentro do bloco acontece junto.
    Em caso de erro ocorre ROLLBACK.
    """

    db = get_db()

    with db.transaction():
        yield db


def travar_contas(db, *ids):
    """
    Trava as contas até o fim da transação.
    A ordem dos IDs evita deadlocks em transferências cruzadas.
    """

    for cid in sorted(set(ids)):
        db.execute(
            "SELECT id FROM contas WHERE id = %s FOR UPDATE",
            (cid,)
        )


# ============================================================================
# ERROS E UTILIDADES
# ============================================================================

class ApiError(Exception):

    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)

        self.mensagem = mensagem
        self.status = status


@app.errorhandler(ApiError)
def tratar_api_error(e):
    return jsonify(
        ok=False,
        erro=e.mensagem
    ), e.status


@app.errorhandler(psycopg.IntegrityError)
def tratar_integridade(_e):
    return jsonify(
        ok=False,
        erro="Não foi possível concluir: dados em conflito."
    ), 409


@app.errorhandler(psycopg.DataError)
def tratar_dados_invalidos(_e):
    return jsonify(
        ok=False,
        erro="Dados inválidos."
    ), 400


@app.errorhandler(ConexaoBancoError)
def tratar_conexao(e):
    return jsonify(
        ok=False,
        erro=str(e)
    ), 503


@app.errorhandler(psycopg.OperationalError)
def tratar_banco_fora(_e):
    return jsonify(
        ok=False,
        erro="O banco de dados está indisponível no momento."
    ), 503


@app.errorhandler(404)
def tratar_404(_e):
    return jsonify(
        ok=False,
        erro="Rota não encontrada."
    ), 404


@app.errorhandler(405)
def tratar_405(_e):
    return jsonify(
        ok=False,
        erro="Método não permitido."
    ), 405


def dados_json():
    dados = request.get_json(silent=True)

    if not isinstance(dados, dict):
        raise ApiError("Envie os dados em formato JSON.")

    return dados


def ok(**extra):
    return jsonify(
        ok=True,
        **extra
    )


def reais_para_centavos(valor, campo="valor"):
    """
    Converte:
    '1.234,56'
    '1234.56'
    1234.56

    para centavos.
    """

    if isinstance(valor, bool) or valor is None:
        raise ApiError(f"Informe o {campo}.")

    texto = (
        str(valor)
        .strip()
        .replace("R$", "")
        .replace(" ", "")
    )

    if "," in texto:

        texto = (
            texto
            .replace(".", "")
            .replace(",", ".")
        )

    elif (
        isinstance(valor, str)
        and re.fullmatch(r"\d{1,3}(\.\d{3})+", texto)
    ):
        texto = texto.replace(".", "")

    try:
        numero = Decimal(texto)

    except InvalidOperation:
        raise ApiError(
            f"O {campo} informado é inválido."
        )

    if not numero.is_finite():
        raise ApiError(
            f"O {campo} informado é inválido."
        )

    centavos = (
        numero * 100
    ).quantize(
        Decimal(1),
        rounding=ROUND_HALF_UP
    )

    if centavos <= 0:
        raise ApiError(
            f"O {campo} precisa ser maior que zero."
        )

    if centavos > VALOR_MAXIMO:
        raise ApiError(
            f"O {campo} máximo por operação é "
            f"R$ 100.000.000,00."
        )

    return int(centavos)


def brl(centavos):
    inteiro, resto = divmod(
        int(centavos),
        100
    )

    return (
        f"R$ {inteiro:,}"
        .replace(",", ".")
        + f",{resto:02d}"
    )


def numero_aleatorio(qtd):
    return "".join(
        str(secrets.randbelow(10))
        for _ in range(qtd)
    )


def login_obrigatorio(f):

    @wraps(f)
    def interno(*args, **kwargs):

        uid = session.get("uid")

        if not uid:
            raise ApiError(
                "Faça login para continuar.",
                401
            )

        usuario = get_db().execute(
            f"""
            SELECT
                u.id,
                u.username,
                u.nome,
                u.email,
                to_char(u.criado_em, {TS}) AS criado_em,
                c.id AS conta_id,
                c.agencia,
                c.numero AS conta_numero

            FROM usuarios u

            JOIN contas c
                ON c.usuario_id = u.id

            WHERE u.id = %s
            """,
            (uid,),
        ).fetchone()

        if usuario is None:

            session.clear()

            raise ApiError(
                "Sessão expirada. Entre novamente.",
                401
            )

        g.user = usuario

        return f(*args, **kwargs)

    return interno


# ============================================================================
# CONTA / POUPANÇA / CARTÃO
# ============================================================================

def aplicar_rendimento(db, conta_id):

    travar_contas(
        db,
        conta_id
    )

    c = db.execute(
        """
        SELECT
            poupanca_centavos AS p,
            poupanca_atualizada_em AS d,
            CURRENT_DATE AS hoje

        FROM contas

        WHERE id = %s
        """,
        (conta_id,),
    ).fetchone()

    dias = min(
        (c["hoje"] - c["d"]).days,
        3650
    )

    if dias <= 0:
        return

    novo = c["p"]

    if c["p"] > 0:

        fator = (
            1 + RENDIMENTO_DIARIO
        ) ** dias

        novo = int(
            (
                Decimal(c["p"]) * fator
            ).to_integral_value(
                rounding=ROUND_DOWN
            )
        )

    db.execute(
        """
        UPDATE contas

        SET
            poupanca_centavos = %s,
            poupanca_atualizada_em = CURRENT_DATE

        WHERE id = %s
        """,
        (
            novo,
            conta_id
        ),
    )

    if novo > c["p"]:

        db.execute(
            """
            INSERT INTO transacoes
                (conta_destino, tipo, valor_centavos, descricao)

            VALUES
                (%s, 'rendimento', %s, 'Rendimento da poupança')
            """,
            (
                conta_id,
                novo - c["p"]
            ),
        )


def saldos(db, conta_id):

    c = db.execute(
        """
        SELECT
            saldo_centavos AS saldo,
            poupanca_centavos AS poupanca

        FROM contas

        WHERE id = %s
        """,
        (conta_id,),
    ).fetchone()

    return {
        "saldo": c["saldo"],
        "poupanca": c["poupanca"],
        "patrimonio": (
            c["saldo"] +
            c["poupanca"]
        ),
    }


def limite_maximo_liberado(patrimonio):

    return min(
        TETO_LIMITE_PADRAO,
        max(
            LIMITE_INICIAL,
            patrimonio * MULTIPLO_PATRIMONIO
        )
    )


def criar_cartao(db, conta_id, tipo):

    hoje = date.today()

    validade = (
        f"{hoje.month:02d}/"
        f"{(hoje.year + 5) % 100:02d}"
    )

    for _ in range(10):

        numero = (
            "9" +
            numero_aleatorio(15)
        )

        if not db.execute(
            "SELECT 1 FROM cartoes WHERE numero = %s",
            (numero,)
        ).fetchone():
            break

    limite = (
        LIMITE_INICIAL
        if tipo == "padrao"
        else None
    )

    db.execute(
        """
        INSERT INTO cartoes
            (
                conta_id,
                tipo,
                numero,
                validade,
                cvv,
                limite_centavos
            )

        VALUES
            (%s, %s, %s, %s, %s, %s)
        """,
        (
            conta_id,
            tipo,
            numero,
            validade,
            numero_aleatorio(3),
            limite,
        ),
    )


def cartao_dict(c, patrimonio):

    d = {
        "id": c["id"],
        "tipo": c["tipo"],
        "numero": c["numero"],
        "final": c["numero"][-4:],
        "validade": c["validade"],
        "cvv": c["cvv"],
        "bloqueado": bool(c["bloqueado"]),
        "limite": c["limite_centavos"],
        "fatura": c["fatura_centavos"],
        "disponivel": (
            None
            if c["limite_centavos"] is None
            else (
                c["limite_centavos"]
                - c["fatura_centavos"]
            )
        ),
    }

    if c["tipo"] == "padrao":
        d["limite_maximo_liberado"] = (
            limite_maximo_liberado(
                patrimonio
            )
        )

    return d


def buscar_cartao(
    db,
    cartao_id,
    travar=False
):

    sql = """
        SELECT *
        FROM cartoes
        WHERE id = %s
        AND conta_id = %s
    """

    if travar:
        sql += " FOR UPDATE"

    c = db.execute(
        sql,
        (
            cartao_id,
            g.user["conta_id"]
        )
    ).fetchone()

    if c is None:
        raise ApiError(
            "Cartão não encontrado.",
            404
        )

    return c


def listar_transacoes(
    db,
    conta_id,
    tipo=None,
    de=None,
    ate=None,
    limite=50,
    offset=0
):

    filtros = []

    params = {
        "c": conta_id,
        "lim": limite,
        "off": offset,
    }

    if tipo == "entrada":
        filtros.append("sinal = 1")

    elif tipo == "saida":
        filtros.append("sinal = -1")

    for nome, operador, valor in (
        ("de", ">=", de),
        ("ate", "<=", ate)
    ):

        if valor:

            try:
                params[nome] = date.fromisoformat(
                    valor
                )

            except ValueError:
                raise ApiError(
                    "Data inválida. "
                    "Use o formato AAAA-MM-DD."
                )

            filtros.append(
                f"ts::date {operador} %({nome})s"
            )

    where = (
        "WHERE " +
        " AND ".join(filtros)
        if filtros
        else ""
    )

    linhas = db.execute(
        f"""
        SELECT
            id,
            tipo,
            valor,
            descricao,
            to_char(ts, {TS}) AS criado_em,
            sinal,
            contraparte

        FROM (

            SELECT
                t.id,
                t.tipo,
                t.valor_centavos AS valor,
                t.descricao,
                t.criado_em AS ts,

                CASE

                    WHEN t.tipo = 'pix'
                         AND t.conta_origem = %(c)s
                    THEN -1

                    WHEN t.tipo = 'pix'
                    THEN 1

                    WHEN t.tipo IN
                        ('deposito', 'poupanca_resgatar')
                    THEN 1

                    WHEN t.tipo IN
                        ('saque',
                         'poupanca_guardar',
                         'pagamento_fatura')
                    THEN -1

                    ELSE 0

                END AS sinal,

                CASE

                    WHEN t.tipo = 'pix'
                    THEN (

                        SELECT u.nome

                        FROM contas c2

                        JOIN usuarios u
                            ON u.id = c2.usuario_id

                        WHERE c2.id =
                            CASE

                                WHEN t.conta_origem = %(c)s
                                THEN t.conta_destino

                                ELSE t.conta_origem

                            END
                    )

                END AS contraparte

            FROM transacoes t

            WHERE
                t.conta_origem = %(c)s
                OR
                t.conta_destino = %(c)s

        ) AS x

        {where}

        ORDER BY id DESC

        LIMIT %(lim)s
        OFFSET %(off)s
        """,
        params,
    ).fetchall()

    return list(linhas)


# ============================================================================
# AUTENTICAÇÃO
# ============================================================================

RE_USERNAME = re.compile(
    r"^[a-z0-9_.]{3,20}$"
)

RE_EMAIL = re.compile(
    r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
)


@app.post("/api/cadastro")
def cadastro():

    d = dados_json()

    username = (
        str(d.get("username", ""))
        .strip()
        .lower()
    )

    nome = (
        str(d.get("nome", ""))
        .strip()
    )

    email = (
        str(d.get("email", ""))
        .strip()
        .lower()
    )

    senha = str(
        d.get("senha", "")
    )

    if not RE_USERNAME.match(username):
        raise ApiError(
            "Usuário: 3 a 20 caracteres, "
            "só letras minúsculas, números, _ ou ."
        )

    if len(nome) < 2 or len(nome) > 80:
        raise ApiError(
            "Informe seu nome completo."
        )

    if not RE_EMAIL.match(email):
        raise ApiError(
            "Informe um e-mail válido."
        )

    if len(senha) < 6:
        raise ApiError(
            "A senha precisa ter pelo menos 6 caracteres."
        )

    with transacao() as db:

        if db.execute(
            "SELECT 1 FROM usuarios WHERE username = %s",
            (username,)
        ).fetchone():

            raise ApiError(
                "Esse nome de usuário já está em uso.",
                409
            )

        if db.execute(
            "SELECT 1 FROM usuarios WHERE email = %s",
            (email,)
        ).fetchone():

            raise ApiError(
                "Esse e-mail já está cadastrado.",
                409
            )

        uid = db.execute(
            """
            INSERT INTO usuarios
                (
                    username,
                    nome,
                    email,
                    senha_hash
                )

            VALUES
                (%s, %s, %s, %s)

            RETURNING id
            """,
            (
                username,
                nome,
                email,
                generate_password_hash(senha),
            ),
        ).fetchone()["id"]

        while True:

            numero = (
                f"{secrets.randbelow(9_000_000) + 1_000_000}"
                f"-{secrets.randbelow(10)}"
            )

            if not db.execute(
                "SELECT 1 FROM contas WHERE numero = %s",
                (numero,)
            ).fetchone():
                break

        conta_id = db.execute(
            """
            INSERT INTO contas
                (
                    usuario_id,
                    agencia,
                    numero
                )

            VALUES
                (%s, %s, %s)

            RETURNING id
            """,
            (
                uid,
                AGENCIA,
                numero
            ),
        ).fetchone()["id"]

        db.execute(
            """
            INSERT INTO chaves_pix
                (
                    conta_id,
                    tipo,
                    chave
                )

            VALUES
                (%s, 'email', %s)
            """,
            (
                conta_id,
                email
            )
        )

        criar_cartao(
            db,
            conta_id,
            "padrao"
        )

    session.clear()

    session["uid"] = uid

    return ok(
        mensagem="Conta criada com sucesso!",
        agencia=AGENCIA,
        conta=numero
    ), 201


@app.post("/api/login")
def login():

    d = dados_json()

    username = (
        str(d.get("username", ""))
        .strip()
        .lower()
    )

    senha = str(
        d.get("senha", "")
    )

    u = get_db().execute(
        """
        SELECT id, senha_hash
        FROM usuarios
        WHERE username = %s
        """,
        (username,)
    ).fetchone()

    if (
        u is None
        or not check_password_hash(
            u["senha_hash"],
            senha
        )
    ):
        raise ApiError(
            "Usuário ou senha incorretos.",
            401
        )

    session.clear()

    session["uid"] = u["id"]

    return ok()


@app.post("/api/logout")
def logout():

    session.clear()

    return ok()


@app.get("/api/eu")
@login_obrigatorio
def eu():

    u = g.user

    return ok(
        username=u["username"],
        nome=u["nome"]
    )


# ============================================================================
# HOME E EXTRATO
# ============================================================================

@app.get("/api/home")
@login_obrigatorio
def home():

    u = g.user

    with transacao() as db:

        aplicar_rendimento(
            db,
            u["conta_id"]
        )

    db = get_db()

    s = saldos(
        db,
        u["conta_id"]
    )

    cartoes = db.execute(
        """
        SELECT *
        FROM cartoes
        WHERE conta_id = %s
        ORDER BY id
        """,
        (u["conta_id"],)
    ).fetchall()

    return ok(
        nome=u["nome"],
        agencia=u["agencia"],
        conta=u["conta_numero"],
        **s,

        cartoes=[
            cartao_dict(
                c,
                s["patrimonio"]
            )
            for c in cartoes
        ],

        transacoes=listar_transacoes(
            db,
            u["conta_id"],
            limite=8
        )
    )


@app.get("/api/extrato")
@login_obrigatorio
def extrato():

    try:

        limite = max(
            1,
            min(
                int(
                    request.args.get(
                        "limite",
                        50
                    )
                ),
                200
            )
        )

        offset = max(
            0,
            int(
                request.args.get(
                    "offset",
                    0
                )
            )
        )

    except ValueError:

        raise ApiError(
            "Parâmetros de paginação inválidos."
        )

    tipo = request.args.get("tipo")

    if tipo not in (
        None,
        "",
        "entrada",
        "saida"
    ):
        raise ApiError(
            "Tipo inválido. "
            "Use 'entrada' ou 'saida'."
        )

    with transacao() as db:

        aplicar_rendimento(
            db,
            g.user["conta_id"]
        )

    return ok(
        transacoes=listar_transacoes(
            get_db(),
            g.user["conta_id"],
            tipo or None,
            request.args.get("de"),
            request.args.get("ate"),
            limite,
            offset,
        )
    )


# ============================================================================
# DEPÓSITO E SAQUE
# ============================================================================

@app.post("/api/depositar")
@login_obrigatorio
def depositar():

    valor = reais_para_centavos(
        dados_json().get("valor")
    )

    cid = g.user["conta_id"]

    with transacao() as db:

        travar_contas(
            db,
            cid
        )

        db.execute(
            """
            UPDATE contas
            SET saldo_centavos =
                saldo_centavos + %s

            WHERE id = %s
            """,
            (
                valor,
                cid
            )
        )

        db.execute(
            """
            INSERT INTO transacoes
                (
                    conta_destino,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    'deposito',
                    %s,
                    'Depósito'
                )
            """,
            (
                cid,
                valor
            )
        )

        s = saldos(
            db,
            cid
        )

    return ok(
        mensagem=f"Depósito de {brl(valor)} realizado.",
        **s
    )


@app.post("/api/sacar")
@login_obrigatorio
def sacar():

    valor = reais_para_centavos(
        dados_json().get("valor")
    )

    cid = g.user["conta_id"]

    with transacao() as db:

        travar_contas(
            db,
            cid
        )

        if saldos(db, cid)["saldo"] < valor:
            raise ApiError(
                "Saldo insuficiente."
            )

        db.execute(
            """
            UPDATE contas

            SET saldo_centavos =
                saldo_centavos - %s

            WHERE id = %s
            """,
            (
                valor,
                cid
            )
        )

        db.execute(
            """
            INSERT INTO transacoes
                (
                    conta_origem,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    'saque',
                    %s,
                    'Saque'
                )
            """,
            (
                cid,
                valor
            )
        )

        s = saldos(
            db,
            cid
        )

    return ok(
        mensagem=f"Saque de {brl(valor)} realizado.",
        **s
    )


# ============================================================================
# PIX
# ============================================================================

def normalizar_chave(tipo, chave):

    chave = str(
        chave or ""
    ).strip()

    if tipo == "email":

        chave = chave.lower()

        if not RE_EMAIL.match(chave):
            raise ApiError(
                "E-mail inválido para a chave Pix."
            )

    elif tipo == "cpf":

        chave = re.sub(
            r"\D",
            "",
            chave
        )

        if len(chave) != 11:
            raise ApiError(
                "O CPF precisa ter 11 dígitos."
            )

    elif tipo == "telefone":

        chave = re.sub(
            r"\D",
            "",
            chave
        )

        if len(chave) not in (10, 11):
            raise ApiError(
                "Telefone inválido (DDD + número)."
            )

    else:

        raise ApiError(
            "Tipo de chave inválido. "
            "Use email, telefone, cpf ou aleatoria."
        )

    return chave


def chaves_da_conta(db, conta_id):

    return list(
        db.execute(
            f"""
            SELECT
                id,
                tipo,
                chave,
                to_char(criada_em, {TS}) AS criada_em

            FROM chaves_pix

            WHERE conta_id = %s

            ORDER BY id
            """,
            (conta_id,)
        ).fetchall()
    )


@app.get("/api/pix/chaves")
@login_obrigatorio
def pix_listar_chaves():

    return ok(
        chaves=chaves_da_conta(
            get_db(),
            g.user["conta_id"]
        )
    )


@app.post("/api/pix/chaves")
@login_obrigatorio
def pix_criar_chave():

    d = dados_json()

    tipo = (
        str(d.get("tipo", ""))
        .strip()
        .lower()
    )

    cid = g.user["conta_id"]

    with transacao() as db:

        travar_contas(
            db,
            cid
        )

        if len(
            chaves_da_conta(
                db,
                cid
            )
        ) >= MAX_CHAVES_PIX:

            raise ApiError(
                f"Você pode ter no máximo "
                f"{MAX_CHAVES_PIX} chaves Pix."
            )

        chave = (
            str(uuid.uuid4())
            if tipo == "aleatoria"
            else normalizar_chave(
                tipo,
                d.get("chave")
            )
        )

        if db.execute(
            "SELECT 1 FROM chaves_pix WHERE chave = %s",
            (chave,)
        ).fetchone():

            raise ApiError(
                "Essa chave já está cadastrada.",
                409
            )

        db.execute(
            """
            INSERT INTO chaves_pix
                (
                    conta_id,
                    tipo,
                    chave
                )

            VALUES
                (%s, %s, %s)
            """,
            (
                cid,
                tipo,
                chave
            )
        )

    return ok(
        mensagem="Chave Pix cadastrada.",
        chave=chave,
        tipo=tipo
    ), 201


@app.delete("/api/pix/chaves/<int:chave_id>")
@login_obrigatorio
def pix_excluir_chave(chave_id):

    with transacao() as db:

        r = db.execute(
            """
            DELETE FROM chaves_pix

            WHERE
                id = %s
                AND conta_id = %s
            """,
            (
                chave_id,
                g.user["conta_id"]
            )
        )

        if r.rowcount == 0:
            raise ApiError(
                "Chave não encontrada.",
                404
            )

    return ok(
        mensagem="Chave removida."
    )


@app.post("/api/pix/enviar")
@login_obrigatorio
def pix_enviar():

    d = dados_json()

    valor = reais_para_centavos(
        d.get("valor")
    )

    chave_bruta = str(
        d.get("chave", "")
    ).strip()

    if not chave_bruta:
        raise ApiError(
            "Informe a chave Pix do destinatário."
        )

    descricao = (
        str(
            d.get("descricao", "")
        )
        .strip()
        [:80]
    )

    origem = g.user["conta_id"]

    with transacao() as db:

        candidatos = [
            chave_bruta,
            chave_bruta.lower(),
            re.sub(
                r"\D",
                "",
                chave_bruta
            ) or chave_bruta
        ]

        destino = None

        for cand in candidatos:

            destino = db.execute(
                """
                SELECT
                    k.chave,
                    k.tipo,
                    c.id AS conta_id,
                    u.nome

                FROM chaves_pix k

                JOIN contas c
                    ON c.id = k.conta_id

                JOIN usuarios u
                    ON u.id = c.usuario_id

                WHERE k.chave = %s
                """,
                (cand,)
            ).fetchone()

            if destino:
                break

        if destino is None:
            raise ApiError(
                "Chave Pix não encontrada.",
                404
            )

        if destino["conta_id"] == origem:
            raise ApiError(
                "Você não pode fazer um Pix "
                "para a sua própria conta."
            )

        travar_contas(
            db,
            origem,
            destino["conta_id"]
        )

        if saldos(
            db,
            origem
        )["saldo"] < valor:

            raise ApiError(
                "Saldo insuficiente."
            )

        db.execute(
            """
            UPDATE contas

            SET saldo_centavos =
                saldo_centavos - %s

            WHERE id = %s
            """,
            (
                valor,
                origem
            )
        )

        db.execute(
            """
            UPDATE contas

            SET saldo_centavos =
                saldo_centavos + %s

            WHERE id = %s
            """,
            (
                valor,
                destino["conta_id"]
            )
        )

        t = db.execute(
            f"""
            INSERT INTO transacoes
                (
                    conta_origem,
                    conta_destino,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    %s,
                    'pix',
                    %s,
                    %s
                )

            RETURNING
                id,
                to_char(
                    criado_em,
                    {TS}
                ) AS criado_em
            """,
            (
                origem,
                destino["conta_id"],
                valor,
                descricao or None
            )
        ).fetchone()

        s = saldos(
            db,
            origem
        )

    return ok(
        mensagem="Pix enviado com sucesso!",

        comprovante={
            "id": t["id"],
            "valor": valor,
            "para": destino["nome"],
            "chave": destino["chave"],
            "de": g.user["nome"],
            "descricao": descricao,
            "criado_em": t["criado_em"],
        },

        **s
    )


@app.post("/api/pix/cobranca")
@login_obrigatorio
def pix_cobranca():

    d = dados_json()

    chave_id = d.get("chave_id")

    if (
        isinstance(chave_id, bool)
        or not isinstance(chave_id, int)
    ):
        raise ApiError(
            "Escolha uma das suas chaves Pix."
        )

    chave = get_db().execute(
        """
        SELECT
            chave,
            tipo

        FROM chaves_pix

        WHERE
            id = %s
            AND conta_id = %s
        """,
        (
            chave_id,
            g.user["conta_id"]
        )
    ).fetchone()

    if chave is None:
        raise ApiError(
            "Escolha uma das suas chaves Pix.",
            404
        )

    valor = (
        reais_para_centavos(d["valor"])
        if d.get("valor") not in (None, "")
        else None
    )

    payload = (
        f"bcx-pix|"
        f"{chave['chave']}|"
        f"{valor if valor else ''}|"
        f"{g.user['nome']}"
    )

    return ok(
        copia_e_cola=payload,
        chave=chave["chave"],
        tipo=chave["tipo"],
        valor=valor
    )


# ============================================================================
# POUPANÇA
# ============================================================================

@app.get("/api/poupanca")
@login_obrigatorio
def poupanca_info():

    with transacao() as db:

        aplicar_rendimento(
            db,
            g.user["conta_id"]
        )

    s = saldos(
        get_db(),
        g.user["conta_id"]
    )

    return ok(
        **s,
        rendimento_diario_percentual=float(
            RENDIMENTO_DIARIO * 100
        )
    )


@app.post("/api/poupanca/guardar")
@login_obrigatorio
def poupanca_guardar():

    valor = reais_para_centavos(
        dados_json().get("valor")
    )

    cid = g.user["conta_id"]

    with transacao() as db:

        aplicar_rendimento(
            db,
            cid
        )

        if saldos(
            db,
            cid
        )["saldo"] < valor:

            raise ApiError(
                "Saldo insuficiente na conta."
            )

        db.execute(
            """
            UPDATE contas

            SET
                saldo_centavos =
                    saldo_centavos - %s,

                poupanca_centavos =
                    poupanca_centavos + %s

            WHERE id = %s
            """,
            (
                valor,
                valor,
                cid
            )
        )

        db.execute(
            """
            INSERT INTO transacoes
                (
                    conta_origem,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    'poupanca_guardar',
                    %s,
                    'Guardado na poupança'
                )
            """,
            (
                cid,
                valor
            )
        )

        s = saldos(
            db,
            cid
        )

    return ok(
        mensagem=f"{brl(valor)} guardados na poupança.",
        **s
    )


@app.post("/api/poupanca/resgatar")
@login_obrigatorio
def poupanca_resgatar():

    valor = reais_para_centavos(
        dados_json().get("valor")
    )

    cid = g.user["conta_id"]

    with transacao() as db:

        aplicar_rendimento(
            db,
            cid
        )

        if saldos(
            db,
            cid
        )["poupanca"] < valor:

            raise ApiError(
                "Saldo insuficiente na poupança."
            )

        db.execute(
            """
            UPDATE contas

            SET
                saldo_centavos =
                    saldo_centavos + %s,

                poupanca_centavos =
                    poupanca_centavos - %s

            WHERE id = %s
            """,
            (
                valor,
                valor,
                cid
            )
        )

        db.execute(
            """
            INSERT INTO transacoes
                (
                    conta_destino,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    'poupanca_resgatar',
                    %s,
                    'Resgate da poupança'
                )
            """,
            (
                cid,
                valor
            )
        )

        s = saldos(
            db,
            cid
        )

    return ok(
        mensagem=f"{brl(valor)} resgatados da poupança.",
        **s
    )


# ============================================================================
# CARTÕES
# ============================================================================
@app.post("/api/cartoes/debito/compra")
@login_obrigatorio
def cartao_debito_compra():

    d = dados_json()
    valor = reais_para_centavos(d.get("valor"))
    loja = str(d.get("estabelecimento", "")).strip()[:60] or "Compra"
    cid = g.user["conta_id"]

    with transacao() as db:

        travar_contas(db, cid)

        if saldos(db, cid)["saldo"] < valor:
            raise ApiError("Saldo insuficiente.")

        db.execute(
            "UPDATE contas SET saldo_centavos = saldo_centavos - %s WHERE id = %s",
            (valor, cid)
        )

        db.execute(
            """
            INSERT INTO transacoes
                (conta_origem, tipo, valor_centavos, descricao)
            VALUES (%s, 'saque', %s, %s)
            """,
            (cid, valor, f"Débito: {loja}")
        )

        s = saldos(db, cid)

    return ok(
        mensagem=f"Compra de {brl(valor)} no débito aprovada em {loja}.",
        **s
    )
@app.get("/api/cartoes")
@login_obrigatorio
def cartoes_listar():

    db = get_db()

    s = saldos(
        db,
        g.user["conta_id"]
    )

    cartoes = db.execute(
        """
        SELECT *
        FROM cartoes
        WHERE conta_id = %s
        ORDER BY id
        """,
        (g.user["conta_id"],)
    ).fetchall()

    return ok(
        cartoes=[
            cartao_dict(
                c,
                s["patrimonio"]
            )
            for c in cartoes
        ],

        patrimonio=s["patrimonio"],

        black_minimo=BLACK_PATRIMONIO_MINIMO,

        black_elegivel=(
            s["patrimonio"]
            >= BLACK_PATRIMONIO_MINIMO
        ),

        tem_black=any(
            c["tipo"] == "black"
            for c in cartoes
        )
    )


@app.post("/api/cartoes/<int:cartao_id>/bloquear")
@login_obrigatorio
def cartao_bloquear(cartao_id):

    bloqueado = dados_json().get(
        "bloqueado"
    )

    if not isinstance(
        bloqueado,
        bool
    ):
        raise ApiError(
            "Informe 'bloqueado' como true ou false."
        )

    with transacao() as db:

        buscar_cartao(
            db,
            cartao_id,
            travar=True
        )

        db.execute(
            """
            UPDATE cartoes

            SET bloqueado = %s

            WHERE id = %s
            """,
            (
                bloqueado,
                cartao_id
            )
        )

    return ok(
        mensagem=(
            "Cartão bloqueado."
            if bloqueado
            else "Cartão desbloqueado."
        ),
        bloqueado=bloqueado
    )


@app.post("/api/cartoes/<int:cartao_id>/limite")
@login_obrigatorio
def cartao_limite(cartao_id):

    novo = reais_para_centavos(
        dados_json().get("novo_limite"),
        "novo limite"
    )

    with transacao() as db:

        c = buscar_cartao(
            db,
            cartao_id,
            travar=True
        )

        if c["tipo"] == "black":
            raise ApiError(
                "O cartão Black não tem limite."
            )

        maximo = limite_maximo_liberado(
            saldos(
                db,
                g.user["conta_id"]
            )["patrimonio"]
        )

        if novo > maximo:

            raise ApiError(
                "Aumento não aprovado. "
                f"O limite máximo liberado para "
                f"o seu perfil é {brl(maximo)}. "
                "Guarde mais dinheiro na conta "
                "ou na poupança para liberar "
                "mais limite."
            )

        if novo < c["fatura_centavos"]:

            raise ApiError(
                "O novo limite não pode ser menor "
                "que a fatura atual."
            )

        db.execute(
            """
            UPDATE cartoes

            SET limite_centavos = %s

            WHERE id = %s
            """,
            (
                novo,
                cartao_id
            )
        )

    return ok(
        mensagem=f"Limite atualizado para {brl(novo)}.",
        limite=novo
    )


@app.post("/api/cartoes/<int:cartao_id>/compra")
@login_obrigatorio
def cartao_compra(cartao_id):

    d = dados_json()

    valor = reais_para_centavos(
        d.get("valor")
    )

    loja = (
        str(
            d.get(
                "estabelecimento",
                ""
            )
        )
        .strip()
        [:60]
        or "Compra"
    )

    with transacao() as db:

        c = buscar_cartao(
            db,
            cartao_id,
            travar=True
        )

        if c["bloqueado"]:
            raise ApiError(
                "Cartão bloqueado. "
                "Desbloqueie para usar."
            )

        if (
            c["limite_centavos"] is not None
            and
            c["fatura_centavos"] + valor
            > c["limite_centavos"]
        ):
            raise ApiError(
                "Compra recusada: "
                "limite insuficiente."
            )

        db.execute(
            """
            UPDATE cartoes

            SET fatura_centavos =
                fatura_centavos + %s

            WHERE id = %s
            """,
            (
                valor,
                cartao_id
            )
        )

        db.execute(
            """
            INSERT INTO compras_cartao
                (
                    cartao_id,
                    estabelecimento,
                    valor_centavos
                )

            VALUES
                (%s, %s, %s)
            """,
            (
                cartao_id,
                loja,
                valor
            )
        )

    return ok(
        mensagem=(
            f"Compra de {brl(valor)} "
            f"aprovada em {loja}."
        )
    )


@app.get("/api/cartoes/<int:cartao_id>/compras")
@login_obrigatorio
def cartao_compras(cartao_id):

    db = get_db()

    buscar_cartao(
        db,
        cartao_id
    )

    linhas = db.execute(
        f"""
        SELECT
            id,
            estabelecimento,
            valor_centavos AS valor,
            to_char(
                criado_em,
                {TS}
            ) AS criado_em

        FROM compras_cartao

        WHERE cartao_id = %s

        ORDER BY id DESC

        LIMIT 50
        """,
        (cartao_id,)
    ).fetchall()

    return ok(
        compras=list(linhas)
    )


@app.post("/api/cartoes/<int:cartao_id>/pagar-fatura")
@login_obrigatorio
def cartao_pagar_fatura(cartao_id):

    d = dados_json()

    cid = g.user["conta_id"]

    with transacao() as db:

        travar_contas(
            db,
            cid
        )

        c = buscar_cartao(
            db,
            cartao_id,
            travar=True
        )

        if c["fatura_centavos"] <= 0:

            raise ApiError(
                "Este cartão não tem fatura em aberto."
            )

        valor = (
            reais_para_centavos(
                d["valor"]
            )
            if d.get("valor") not in (None, "")
            else c["fatura_centavos"]
        )

        if valor > c["fatura_centavos"]:

            raise ApiError(
                f"O valor é maior que a fatura "
                f"({brl(c['fatura_centavos'])})."
            )

        if saldos(
            db,
            cid
        )["saldo"] < valor:

            raise ApiError(
                "Saldo insuficiente para "
                "pagar a fatura."
            )

        db.execute(
            """
            UPDATE contas

            SET saldo_centavos =
                saldo_centavos - %s

            WHERE id = %s
            """,
            (
                valor,
                cid
            )
        )

        db.execute(
            """
            UPDATE cartoes

            SET fatura_centavos =
                fatura_centavos - %s

            WHERE id = %s
            """,
            (
                valor,
                cartao_id
            )
        )

        db.execute(
            """
            INSERT INTO transacoes
                (
                    conta_origem,
                    tipo,
                    valor_centavos,
                    descricao
                )

            VALUES
                (
                    %s,
                    'pagamento_fatura',
                    %s,
                    %s
                )
            """,
            (
                cid,
                valor,
                f"Fatura do cartão final "
                f"{c['numero'][-4:]}"
            )
        )

        s = saldos(
            db,
            cid
        )

    return ok(
        mensagem=f"Fatura paga: {brl(valor)}.",
        **s
    )


@app.post("/api/cartoes/black")
@login_obrigatorio
def cartao_black():

    cid = g.user["conta_id"]

    with transacao() as db:

        aplicar_rendimento(
            db,
            cid
        )

        if db.execute(
            """
            SELECT 1
            FROM cartoes

            WHERE
                conta_id = %s
                AND tipo = 'black'
            """,
            (cid,)
        ).fetchone():

            raise ApiError(
                "Você já tem o cartão Black.",
                409
            )

        patrimonio = saldos(
            db,
            cid
        )["patrimonio"]

        if patrimonio < BLACK_PATRIMONIO_MINIMO:

            raise ApiError(
                "Para ter direito ao cartão Black "
                f"é preciso ter "
                f"{brl(BLACK_PATRIMONIO_MINIMO)} "
                "na conta. "
                f"Você tem {brl(patrimonio)}."
            )

        criar_cartao(
            db,
            cid,
            "black"
        )

    return ok(
        mensagem=(
            "Parabéns! Seu cartão Black, "
            "sem limite, foi liberado."
        )
    ), 201


# ============================================================================
# PERFIL
# ============================================================================

@app.get("/api/perfil")
@login_obrigatorio
def perfil():

    u = g.user

    return ok(
        username=u["username"],
        nome=u["nome"],
        email=u["email"],
        criado_em=u["criado_em"],
        agencia=u["agencia"],
        conta=u["conta_numero"],
    )


@app.put("/api/perfil")
@login_obrigatorio
def perfil_editar():

    d = dados_json()

    nome = (
        str(
            d.get(
                "nome",
                g.user["nome"]
            )
        )
        .strip()
    )

    email = (
        str(
            d.get(
                "email",
                g.user["email"]
            )
        )
        .strip()
        .lower()
    )

    if len(nome) < 2 or len(nome) > 80:

        raise ApiError(
            "Informe seu nome completo."
        )

    if not RE_EMAIL.match(email):

        raise ApiError(
            "Informe um e-mail válido."
        )

    with transacao() as db:

        if db.execute(
            """
            SELECT 1
            FROM usuarios

            WHERE
                email = %s
                AND id <> %s
            """,
            (
                email,
                g.user["id"]
            )
        ).fetchone():

            raise ApiError(
                "Esse e-mail já está cadastrado.",
                409
            )

        db.execute(
            """
            UPDATE usuarios

            SET
                nome = %s,
                email = %s

            WHERE id = %s
            """,
            (
                nome,
                email,
                g.user["id"]
            )
        )

    return ok(
        mensagem="Perfil atualizado."
    )


@app.post("/api/perfil/senha")
@login_obrigatorio
def perfil_senha():

    d = dados_json()

    atual = str(
        d.get(
            "senha_atual",
            ""
        )
    )

    nova = str(
        d.get(
            "nova_senha",
            ""
        )
    )

    u = get_db().execute(
        """
        SELECT senha_hash
        FROM usuarios
        WHERE id = %s
        """,
        (g.user["id"],)
    ).fetchone()

    if not check_password_hash(
        u["senha_hash"],
        atual
    ):

        raise ApiError(
            "A senha atual está incorreta.",
            401
        )

    if len(nova) < 6:

        raise ApiError(
            "A nova senha precisa ter "
            "pelo menos 6 caracteres."
        )

    with transacao() as db:

        db.execute(
            """
            UPDATE usuarios

            SET senha_hash = %s

            WHERE id = %s
            """,
            (
                generate_password_hash(nova),
                g.user["id"]
            )
        )

    return ok(
        mensagem="Senha alterada com sucesso."
    )


# ============================================================================
# ARQUIVOS DO SITE
# ============================================================================
#
# Estrutura:
#
# Banco/
#
#   Back-end/
#       back.py
#
#   entrada/
#       entrada.html
#       entrada.css
#       entrada.js
#
#   home/
#       index.html
#       style.css
#       script.js
#
#   imagens/
#       ...
#
# Rotas:
#
#   /                         -> entrada/entrada.html
#
#   /entrada/entrada.html    -> página de login
#
#   /home/                    -> home/index.html
#
#   /home/style.css           -> CSS da Home
#
#   /home/script.js           -> JS da Home
#
#   /home/imagem.png         -> imagem da Home
#
# ============================================================================

PASTAS_BLOQUEADAS = {
    "back-end",
    "backend",
    "back_end",
    "__pycache__",
    "node_modules",
}


EXTENSOES_PUBLICAS = {
    ".html",
    ".css",
    ".js",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
}


def servir_arquivo_do_site(
    pasta,
    arquivo
):

    # Bloqueia pastas ocultas e pastas internas
    if (
        pasta.startswith(".")
        or pasta.startswith("_")
        or pasta.lower() in PASTAS_BLOQUEADAS
    ):
        abort(404)

    # Só permite extensões públicas
    if (
        os.path.splitext(arquivo)[1].lower()
        not in EXTENSOES_PUBLICAS
    ):
        abort(404)

    diretorio = os.path.join(
        RAIZ,
        pasta
    )

    if not os.path.isdir(diretorio):
        abort(404)

    resposta = send_from_directory(
        diretorio,
        arquivo
    )

    # Durante o desenvolvimento,
    # sempre carrega a versão mais recente.
    resposta.headers["Cache-Control"] = "no-cache"

    return resposta


# ============================================================================
# PÁGINA INICIAL
# ============================================================================

@app.get("/")
def pagina_inicial():

    return redirect(
        "/entrada/entrada.html"
    )


# ============================================================================
# ABRIR PASTAS DO SITE
# ============================================================================

@app.get("/<pasta>/")
def pagina_da_pasta(pasta):

    # HOME usa index.html
    if pasta.lower() == "home":

        try:
            return servir_arquivo_do_site(
                pasta,
                "index.html"
            )

        except NotFound:
            raise

    # As outras pastas continuam usando:
    # pasta/pasta.html
    try:

        return servir_arquivo_do_site(
            pasta,
            f"{pasta}.html"
        )

    except NotFound:

        raise


# ============================================================================
# ARQUIVOS INTERNOS DAS PASTAS
# ============================================================================

@app.get("/<pasta>/<path:arquivo>")
def arquivo_do_site(
    pasta,
    arquivo
):

    return servir_arquivo_do_site(
        pasta,
        arquivo
    )


# ============================================================================
# INICIAR
# ============================================================================

if __name__ == "__main__":

    try:

        init_db()

    except ConexaoBancoError as erro:

        print(
            f"\nERRO: {erro}\n"
            f"  Causa original: "
            f"{erro.__cause__!r}\n",
            file=sys.stderr
        )

        sys.exit(1)

    app.run(
    host="0.0.0.0",
    debug=True,
    port=5000
)