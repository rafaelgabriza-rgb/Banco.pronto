// ==========================================
// BANCO CENTRALX - EXTRATO
// extrato/extrato.js
// ==========================================
//
// API utilizada:
// GET /api/extrato?limite=200
//
// O backend devolve dinheiro em CENTAVOS.
// Exemplo:
// 150050 -> R$ 1.500,50
// ==========================================


const PAGINA_ENTRADA = "/entrada/entrada.html";

let transacoes = [];
let redirecionando = false;


// ==========================================
// ELEMENTOS
// ==========================================

const listaExtrato = document.getElementById("lista-extrato");

const campoBusca = document.getElementById("campo-busca");
const filtroTipo = document.getElementById("filtro-tipo");

const botaoAtualizar = document.getElementById("botao-atualizar");
const botaoSair = document.getElementById("botao-sair");

const inicialUsuario = document.getElementById("inicial-usuario");

const totalEntradas = document.getElementById("total-entradas");
const totalSaidas = document.getElementById("total-saidas");
const totalMovimentacoes = document.getElementById("total-movimentacoes");

const textoResultado = document.getElementById("texto-resultado");


// ==========================================
// ERRO DA API
// ==========================================

class ErroApi extends Error {

    constructor(mensagem, status) {

        super(mensagem);

        this.status = status;
    }
}


// ==========================================
// API
// ==========================================

async function api(rota, { metodo = "GET", corpo } = {}) {

    let resposta;

    try {

        resposta = await fetch(rota, {

            method: metodo,

            headers: corpo
                ? { "Content-Type": "application/json" }
                : {},

            body: corpo
                ? JSON.stringify(corpo)
                : undefined,

            credentials: "same-origin",

            cache: "no-store"
        });

    } catch (_) {

        throw new ErroApi(
            "Não foi possível falar com o servidor. Confira se o back.py está rodando.",
            0
        );
    }


    // Sessão expirada
    if (resposta.status === 401) {

        if (!redirecionando) {

            redirecionando = true;

            window.location.href = PAGINA_ENTRADA;
        }

        throw new ErroApi(
            "Sessão expirada. Entre novamente.",
            401
        );
    }


    const corpoResposta = await resposta
        .json()
        .catch(() => null);


    if (
        !resposta.ok ||
        !corpoResposta ||
        corpoResposta.ok === false
    ) {

        throw new ErroApi(
            corpoResposta?.erro ||
            "Algo deu errado. Tente de novo.",
            resposta.status
        );
    }


    return corpoResposta;
}


// ==========================================
// FORMATAÇÃO
// ==========================================

function formatarMoeda(centavos) {

    const numero = Number(centavos);

    if (!Number.isFinite(numero)) {
        return "R$ 0,00";
    }

    return (numero / 100).toLocaleString("pt-BR", {

        style: "currency",

        currency: "BRL"
    });
}


// "2026-09-20 18:49:00"
// ->
// "20/09/2026 às 18:49"

function formatarData(texto) {

    const partes =
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(
            texto || ""
        );


    if (!partes) {
        return texto || "";
    }


    const [
        ,
        ano,
        mes,
        dia,
        hora,
        minuto
    ] = partes;


    return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}


// ==========================================
// TIPO DA MOVIMENTAÇÃO
// ==========================================

function ehEntrada(transacao) {

    return Number(transacao.sinal) === 1 ||
        transacao.tipo === "rendimento";
}


function ehSaida(transacao) {

    return Number(transacao.sinal) === -1;
}


function nomeTipo(transacao) {

    const tipo = transacao.tipo;

    switch (tipo) {

        case "pix":

            if (ehSaida(transacao)) {
                return "Pix enviado";
            }

            return "Pix recebido";


        case "deposito":
            return "Depósito";


        case "saque":

            if (
                String(transacao.descricao || "")
                    .startsWith("Débito:")
            ) {
                return "Compra no débito";
            }

            return "Saque";


        case "poupanca_guardar":
            return "Dinheiro guardado";


        case "poupanca_resgatar":
            return "Resgate da poupança";


        case "rendimento":
            return "Rendimento da poupança";


        case "pagamento_fatura":
            return "Pagamento de fatura";


        default:
            return transacao.descricao ||
                "Movimentação";
    }
}


// ==========================================
// ÍCONE
// ==========================================

function iconeTipo(transacao) {

    switch (transacao.tipo) {

        case "pix":
            return "↔";

        case "deposito":
            return "↓";

        case "saque":
            return "↑";

        case "poupanca_guardar":
            return "◉";

        case "poupanca_resgatar":
            return "◉";

        case "rendimento":
            return "%";

        case "pagamento_fatura":
            return "▣";

        default:
            return "•";
    }
}


// ==========================================
// DETALHE
// ==========================================

function detalheTipo(transacao) {

    const tipo = transacao.tipo;

    if (tipo === "pix") {

        if (transacao.contraparte) {

            return transacao.contraparte;
        }

        return transacao.descricao || "Pix";
    }


    if (tipo === "saque") {

        const descricao =
            String(transacao.descricao || "");

        if (descricao.startsWith("Débito:")) {

            return descricao.replace(
                /^Débito:\s*/,
                ""
            );
        }

        return descricao || "Conta corrente";
    }


    if (tipo === "pagamento_fatura") {

        return transacao.descricao ||
            "Pagamento da fatura do cartão";
    }


    return transacao.descricao || "";
}


// ==========================================
// CRIAR ITEM
// ==========================================

function criarItem(transacao) {

    const entrada = ehEntrada(transacao);

    const classeMovimento =
        entrada ? "entrada" : "saida";


    const item =
        document.createElement("article");

    item.className = "extrato-item";


    // --------------------------------------
    // ESQUERDA
    // --------------------------------------

    const esquerda =
        document.createElement("div");

    esquerda.className =
        "extrato-item__esquerda";


    const icone =
        document.createElement("div");

    icone.className =
        `extrato-item__icone ${classeMovimento}`;

    icone.textContent =
        iconeTipo(transacao);


    const informacoes =
        document.createElement("div");

    informacoes.className =
        "extrato-item__informacoes";


    const titulo =
        document.createElement("p");

    titulo.className =
        "extrato-item__titulo";

    titulo.textContent =
        nomeTipo(transacao);


    const detalhe =
        document.createElement("p");

    detalhe.className =
        "extrato-item__detalhe";

    detalhe.textContent =
        detalheTipo(transacao);


    informacoes.append(
        titulo,
        detalhe
    );


    esquerda.append(
        icone,
        informacoes
    );


    // --------------------------------------
    // DIREITA
    // --------------------------------------

    const direita =
        document.createElement("div");

    direita.className =
        "extrato-item__direita";


    const valor =
        document.createElement("span");

    valor.className =
        `extrato-item__valor ${classeMovimento}`;


    const sinal =
        entrada ? "+" : "−";


    valor.textContent =
        `${sinal} ${formatarMoeda(transacao.valor)}`;


    const data =
        document.createElement("span");

    data.className =
        "extrato-item__data";

    data.textContent =
        formatarData(transacao.criado_em);


    direita.append(
        valor,
        data
    );


    item.append(
        esquerda,
        direita
    );


    return item;
}


// ==========================================
// FILTRO
// ==========================================

function correspondeAoFiltro(transacao) {

    const filtro =
        filtroTipo.value;


    if (filtro === "todos") {
        return true;
    }


    if (filtro === "entrada") {

        return ehEntrada(transacao);
    }


    if (filtro === "saida") {

        return ehSaida(transacao);
    }


    if (filtro === "pix") {

        return transacao.tipo === "pix";
    }


    if (filtro === "deposito") {

        return transacao.tipo === "deposito";
    }


    if (filtro === "saque") {

        return transacao.tipo === "saque";
    }


    if (filtro === "poupanca") {

        return [
            "poupanca_guardar",
            "poupanca_resgatar"
        ].includes(transacao.tipo);
    }


    if (filtro === "pagamento_fatura") {

        return transacao.tipo === "pagamento_fatura";
    }


    if (filtro === "rendimento") {

        return transacao.tipo === "rendimento";
    }


    return true;
}


function correspondeBusca(transacao) {

    const busca =
        campoBusca.value
            .trim()
            .toLowerCase();


    if (!busca) {
        return true;
    }


    const texto = [

        transacao.tipo,

        transacao.descricao,

        transacao.contraparte,

        nomeTipo(transacao),

        detalheTipo(transacao)

    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();


    return texto.includes(busca);
}


// ==========================================
// DESENHAR
// ==========================================

function desenhar() {

    const busca =
        transacoes.filter((transacao) => {

            return correspondeAoFiltro(transacao) &&
                correspondeBusca(transacao);

        });


    // --------------------------------------
    // RESUMO
    // --------------------------------------

    let entradas = 0;
    let saidas = 0;


    busca.forEach((transacao) => {

        const valor =
            Number(transacao.valor) || 0;


        if (ehEntrada(transacao)) {

            entradas += valor;

        } else if (ehSaida(transacao)) {

            saidas += valor;
        }
    });


    totalEntradas.textContent =
        formatarMoeda(entradas);


    totalSaidas.textContent =
        formatarMoeda(saidas);


    totalMovimentacoes.textContent =
        busca.length;


    textoResultado.textContent =
        busca.length === 1
            ? "1 movimentação encontrada"
            : `${busca.length} movimentações encontradas`;


    // --------------------------------------
    // LISTA
    // --------------------------------------

    if (busca.length === 0) {

        const vazio =
            document.createElement("div");

        vazio.className =
            "extrato-vazio";

        vazio.textContent =
            "Nenhuma movimentação encontrada.";


        listaExtrato.replaceChildren(vazio);

        return;
    }


    listaExtrato.replaceChildren(
        ...busca.map(criarItem)
    );
}


// ==========================================
// CARREGAR EXTRATO
// ==========================================

async function carregarExtrato() {

    listaExtrato.replaceChildren();


    const carregando =
        document.createElement("div");

    carregando.className =
        "extrato-vazio";

    carregando.textContent =
        "Carregando extrato...";


    listaExtrato.appendChild(carregando);


    try {

        const dados =
            await api("/api/extrato?limite=200");


        transacoes =
            Array.isArray(dados.transacoes)
                ? dados.transacoes
                : [];


        // Ordena da mais recente para a mais antiga
        transacoes.sort((a, b) => {

            return String(b.criado_em || "")
                .localeCompare(
                    String(a.criado_em || "")
                );

        });


        desenhar();


    } catch (erro) {

        if (erro.status === 401) {
            return;
        }


        const caixa =
            document.createElement("div");

        caixa.className =
            "extrato-vazio extrato-vazio--erro";

        caixa.textContent =
            erro.message;


        listaExtrato.replaceChildren(caixa);

        textoResultado.textContent =
            "Não foi possível carregar o extrato.";
    }
}


// ==========================================
// EVENTOS DOS FILTROS
// ==========================================

campoBusca.addEventListener(
    "input",
    desenhar
);


filtroTipo.addEventListener(
    "change",
    desenhar
);


botaoAtualizar.addEventListener(
    "click",
    carregarExtrato
);


// ==========================================
// SAIR
// ==========================================

botaoSair.addEventListener(
    "click",
    async () => {

        try {

            await fetch(
                "/api/logout",
                {
                    method: "POST",
                    credentials: "same-origin"
                }
            );

        } catch (erro) {

            console.error(
                "Erro ao sair:",
                erro
            );

        } finally {

            window.location.href =
                PAGINA_ENTRADA;
        }
    }
);


// ==========================================
// CARREGAR USUÁRIO
// ==========================================

async function carregarUsuario() {

    try {

        const dados =
            await api("/api/home");


        const nome =
            dados.nome || "Usuário";


        inicialUsuario.textContent =
            nome.charAt(0).toUpperCase();


    } catch (erro) {

        if (erro.status !== 401) {

            console.error(
                "Não foi possível carregar o usuário:",
                erro
            );
        }
    }
}


// ==========================================
// INICIAR
// ==========================================

async function iniciar() {

    await Promise.all([
        carregarUsuario(),
        carregarExtrato()
    ]);
}


document.addEventListener(
    "DOMContentLoaded",
    iniciar
);