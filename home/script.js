// ==========================================
// BANCO CENTRALX - HOME
// home/script.js
// ==========================================
// Todos os dados vêm de GET /api/home (Flask + PostgreSQL).
// ATENÇÃO: a API devolve dinheiro em CENTAVOS (ex.: 150050 = R$ 1.500,50),
// por isso formatarMoeda() divide por 100.

let dadosHome = null;
let saldoOculto = lerPreferenciaSaldo();


// ==========================================
// ELEMENTOS (os ids são os do index.html)
// ==========================================

const nomeUsuario = document.getElementById("nome-usuario");
const inicialUsuario = document.getElementById("inicial-usuario");
const agenciaUsuario = document.getElementById("agencia");
const contaUsuario = document.getElementById("numero-conta");

const saldo = document.getElementById("saldo-conta");
const poupanca = document.getElementById("saldo-poupanca");
const patrimonio = document.getElementById("patrimonio");

const listaTransacoes = document.getElementById("lista-transacoes");
const quantidadeCartoes = document.getElementById("quantidade-cartoes");

const btnSair = document.getElementById("botao-sair");
const btnAlternarSaldo = document.getElementById("alternar-saldo");


// ==========================================
// FORMATAR
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

// "2026-09-20 18:49:00" -> "20/09/2026 às 18:49"
function formatarData(texto) {
    const partes = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(texto || "");

    if (!partes) {
        return texto || "";
    }

    const [, ano, mes, dia, hora, minuto] = partes;

    return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}

function valorVisivel(centavos) {
    return saldoOculto ? "R$ ••••••" : formatarMoeda(centavos);
}


// ==========================================
// PREFERÊNCIA: OCULTAR SALDO
// ==========================================

function lerPreferenciaSaldo() {
    try {
        return localStorage.getItem("bcx-saldo-oculto") === "1";
    } catch (_) {
        return false;
    }
}

function salvarPreferenciaSaldo() {
    try {
        localStorage.setItem("bcx-saldo-oculto", saldoOculto ? "1" : "0");
    } catch (_) {
        /* navegador sem localStorage: só não lembra da escolha */
    }
}

function alternarSaldo() {
    saldoOculto = !saldoOculto;
    salvarPreferenciaSaldo();
    preencherValores();
}


// ==========================================
// CARREGAR HOME
// ==========================================

async function carregarHome() {

    try {

        const resposta = await fetch("/api/home", {
            method: "GET",
            credentials: "same-origin"
        });

        if (resposta.status === 401) {
            window.location.href = "/entrada/entrada.html";
            return;
        }

        const dados = await resposta.json().catch(() => null);

        if (!resposta.ok || !dados || dados.ok === false) {
            throw new Error(
                (dados && dados.erro) || "Erro ao carregar os dados da conta."
            );
        }

        dadosHome = dados;

        preencherUsuario();
        preencherValores();
        preencherCartoes();
        preencherTransacoes();

    } catch (erro) {

        console.error("Erro:", erro);

        mostrarErro(
            "Não foi possível carregar os dados da sua conta. " +
            "Confira se o back.py está rodando."
        );
    }
}


// ==========================================
// PREENCHER USUÁRIO
// ==========================================

function preencherUsuario() {

    if (!dadosHome) {
        return;
    }

    const nome = dadosHome.nome || "Usuário";

    if (nomeUsuario) {
        nomeUsuario.textContent = nome;
    }

    if (inicialUsuario) {
        inicialUsuario.textContent = nome.charAt(0).toUpperCase();
    }

    if (agenciaUsuario) {
        agenciaUsuario.textContent = dadosHome.agencia || "—";
    }

    if (contaUsuario) {
        contaUsuario.textContent = dadosHome.conta || "—";
    }
}


// ==========================================
// PREENCHER VALORES
// ==========================================

function preencherValores() {

    if (!dadosHome) {
        return;
    }

    if (saldo) {
        saldo.textContent = valorVisivel(dadosHome.saldo);
    }

    if (poupanca) {
        poupanca.textContent = valorVisivel(dadosHome.poupanca);
    }

    if (patrimonio) {
        patrimonio.textContent = valorVisivel(dadosHome.patrimonio);
    }

    if (btnAlternarSaldo) {
        btnAlternarSaldo.textContent = saldoOculto ? "Mostrar" : "Ocultar";
        btnAlternarSaldo.setAttribute("aria-pressed", String(saldoOculto));
    }
}


// ==========================================
// CARTÕES
// ==========================================

function preencherCartoes() {

    if (!dadosHome || !quantidadeCartoes) {
        return;
    }

    const cartoes = Array.isArray(dadosHome.cartoes)
        ? dadosHome.cartoes
        : [];

    quantidadeCartoes.textContent = cartoes.length;
}


// ==========================================
// TRANSAÇÕES
// ==========================================

// Título mostrado para cada tipo de movimentação
function tituloDaTransacao(t) {

    switch (t.tipo) {

        case "pix":
            if (t.sinal === -1) {
                return t.contraparte ? `Pix enviado para ${t.contraparte}` : "Pix enviado";
            }
            return t.contraparte ? `Pix recebido de ${t.contraparte}` : "Pix recebido";

        case "deposito":
            return "Depósito";

                case "saque":
            return (t.descricao || "").startsWith("Débito:")
                ? t.descricao
                : "Saque";

        case "poupanca_guardar":
            return "Guardado na poupança";

        case "poupanca_resgatar":
            return "Resgate da poupança";

        case "rendimento":
            return "Rendimento da poupança";

        case "pagamento_fatura":
            return t.descricao || "Pagamento de fatura";

        default:
            return t.descricao || "Movimentação";
    }
}

function criarLinhaTransacao(t) {

    // sinal vem da API: 1 = entrada, -1 = saída, 0 = rendimento (não mexe no saldo da conta)
    const entrada = t.sinal === 1 || t.tipo === "rendimento";
    const prefixo = entrada ? "+" : "−";

    const item = document.createElement("div");
    item.className = "transacao " + (entrada ? "transacao--entrada" : "transacao--saida");

    const info = document.createElement("div");
    info.className = "transacao__info";

    const titulo = document.createElement("p");
    titulo.className = "transacao__descricao";
    titulo.textContent = tituloDaTransacao(t);
    info.appendChild(titulo);

    // No Pix, a "descrição" é o recado que a pessoa escreveu
    if (t.tipo === "pix" && t.descricao) {
        const recado = document.createElement("p");
        recado.className = "transacao__detalhe";
        recado.textContent = t.descricao;
        info.appendChild(recado);
    }

    const data = document.createElement("p");
    data.className = "transacao__data";
    data.textContent = formatarData(t.criado_em);
    info.appendChild(data);

    const valor = document.createElement("span");
    valor.className = "transacao__valor";
    valor.textContent = `${prefixo} ${formatarMoeda(t.valor)}`;

    item.appendChild(info);
    item.appendChild(valor);

    return item;
}

function preencherTransacoes() {

    if (!listaTransacoes || !dadosHome) {
        return;
    }

    const transacoes = Array.isArray(dadosHome.transacoes)
        ? dadosHome.transacoes
        : [];

    listaTransacoes.replaceChildren();

    if (transacoes.length === 0) {

        const vazia = document.createElement("div");
        vazia.className = "transacao transacao--vazia";

        const texto = document.createElement("p");
        texto.textContent = "Nenhuma movimentação ainda.";

        vazia.appendChild(texto);
        listaTransacoes.appendChild(vazia);

        return;
    }

    transacoes.forEach((t) => {
        listaTransacoes.appendChild(criarLinhaTransacao(t));
    });
}


// ==========================================
// LOGOUT
// ==========================================

async function sair() {

    try {

        await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin"
        });

    } catch (erro) {

        console.error("Erro ao sair:", erro);

    } finally {

        window.location.href = "/entrada/entrada.html";
    }
}


// ==========================================
// MOSTRAR ERRO
// ==========================================

function mostrarErro(mensagem) {

    if (!listaTransacoes) {
        return;
    }

    listaTransacoes.replaceChildren();

    const caixa = document.createElement("div");
    caixa.className = "transacao transacao--vazia transacao--erro";

    const texto = document.createElement("p");
    texto.textContent = mensagem;

    caixa.appendChild(texto);
    listaTransacoes.appendChild(caixa);
}


// ==========================================
// EVENTOS
// ==========================================

if (btnSair) {
    btnSair.addEventListener("click", sair);
}

if (btnAlternarSaldo) {
    btnAlternarSaldo.addEventListener("click", alternarSaldo);
}

// Pix e Transferir abrem a tela do Pix
document.querySelectorAll('.acao[data-acao="pix"], .acao[data-acao="transferir"]').forEach((botao) => {
    botao.addEventListener("click", () => {
        window.location.href = "/pix/#enviar";
    });
});



document.querySelectorAll('.acao[data-acao="poupanca"]').forEach((botao) => {
    botao.addEventListener("click", () => {
        window.location.href = "/poupanca/";
    });
});


document.querySelector('.botao-link[data-acao="poupanca"]')?.addEventListener("click", () => {
    window.location.href = "/poupanca/";
});

// ==========================================
// INICIAR
// ==========================================

document.addEventListener("DOMContentLoaded", carregarHome);
