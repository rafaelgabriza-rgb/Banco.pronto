// ==========================================
// BANCO CENTRALX - PIX
// pix/pix.js
// ==========================================
// Todos os dados vêm da API (Flask + PostgreSQL).
// ATENÇÃO: a API guarda e devolve dinheiro em CENTAVOS (150050 = R$ 1.500,50).
// Os campos de valor desta página trabalham em centavos e só convertem para
// reais na hora de enviar ("1500.50").

const PAGINA_ENTRADA = "/entrada/entrada.html";
const MAX_CHAVES = 5; // mesmo limite do back.py (MAX_CHAVES_PIX)

let saldoCentavos = 0;
let chaves = [];
let pixPendente = null;      // dados digitados, esperando a confirmação
let ultimaCobranca = null;   // último código "copia e cola" gerado
let redirecionando = false;   // já estamos indo para a tela de entrada


// ==========================================
// ELEMENTOS
// ==========================================

const $ = (id) => document.getElementById(id);

const saldoConta = $("saldo-conta");
const inicialUsuario = $("inicial-usuario");
const btnSair = $("botao-sair");
const avisoCopiado = $("aviso-copiado");

// enviar
const formEnviar = $("form-enviar");
const enviarChave = $("enviar-chave");
const enviarValor = $("enviar-valor");
const enviarMensagem = $("enviar-mensagem");
const dicaCodigo = $("dica-codigo");
const erroEnviar = $("erro-enviar");
const etapaConfirmar = $("etapa-confirmar");
const erroConfirmar = $("erro-confirmar");
const btnConfirmar = $("botao-confirmar");
const btnVoltarForm = $("botao-voltar-form");
const etapaComprovante = $("etapa-comprovante");
const btnNovoPix = $("botao-novo-pix");

// receber
const formReceber = $("form-receber");
const receberChave = $("receber-chave");
const receberValor = $("receber-valor");
const erroReceber = $("erro-receber");
const resultadoCobranca = $("resultado-cobranca");
const cobrancaResumo = $("cobranca-resumo");
const cobrancaCodigo = $("cobranca-codigo");
const btnCopiarCodigo = $("copiar-codigo");
const btnCopiarChaveReceber = $("copiar-chave-receber");

// chaves
const listaChaves = $("lista-chaves");
const contagemChaves = $("contagem-chaves");
const formChave = $("form-chave");
const chaveTipo = $("chave-tipo");
const chaveValor = $("chave-valor");
const campoChaveValor = $("campo-chave-valor");
const rotuloChaveValor = $("rotulo-chave-valor");
const dicaAleatoria = $("dica-aleatoria");
const erroChave = $("erro-chave");

// histórico
const listaPix = $("lista-pix");


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

const NOMES_TIPO = {
    email: "E-mail",
    cpf: "CPF",
    telefone: "Telefone",
    aleatoria: "Chave aleatória"
};

function formatarChave(tipo, chave) {
    const d = String(chave).replace(/\D/g, "");

    if (tipo === "cpf" && d.length === 11) {
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    }

    if (tipo === "telefone" && (d.length === 10 || d.length === 11)) {
        const ddd = d.slice(0, 2);
        const resto = d.slice(2);
        const corte = resto.length - 4;
        return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
    }

    return chave;
}


// ==========================================
// CAMPO DE VALOR (máscara em centavos)
// ==========================================
// A pessoa digita só números: 1 -> R$ 0,01 | 15 -> R$ 0,15 | 1500 -> R$ 15,00

function apenasDigitos(texto) {
    return String(texto).replace(/\D/g, "");
}

function aplicarMascara(campo) {
    // máximo de 11 dígitos = R$ 100.000.000,00 (limite por operação do back.py)
    const digitos = apenasDigitos(campo.value).replace(/^0+/, "").slice(0, 11);

    campo.value = digitos ? formatarMoeda(parseInt(digitos, 10)) : "";
}

function centavosDoCampo(campo) {
    const digitos = apenasDigitos(campo.value);

    return digitos ? parseInt(digitos, 10) : 0;
}

function definirValor(campo, centavos) {
    campo.value = centavos > 0 ? formatarMoeda(centavos) : "";
}

// "1500.50" (reais em texto) a partir de centavos
function centavosParaReaisTexto(centavos) {
    return (centavos / 100).toFixed(2);
}


// ==========================================
// CONVERSA COM O SERVIDOR
// ==========================================

class ErroApi extends Error {
    constructor(mensagem, status) {
        super(mensagem);
        this.status = status;
    }
}

async function api(rota, { metodo = "GET", corpo } = {}) {

    let resposta;

    try {

        resposta = await fetch(rota, {
            method: metodo,
            headers: corpo ? { "Content-Type": "application/json" } : {},
            body: corpo ? JSON.stringify(corpo) : undefined,
            credentials: "same-origin"
        });

    } catch (_) {

        throw new ErroApi(
            "Não foi possível falar com o servidor. Confira se o back.py está rodando.",
            0
        );
    }

    if (resposta.status === 401) {
        // várias chamadas podem receber 401 juntas: manda para a entrada só uma vez
        if (!redirecionando) {
            redirecionando = true;
            window.location.href = PAGINA_ENTRADA;
        }
        throw new ErroApi("Sessão expirada. Entre novamente.", 401);
    }

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok || !dados || dados.ok === false) {
        throw new ErroApi(
            (dados && dados.erro) || "Algo deu errado. Tente de novo.",
            resposta.status
        );
    }

    return dados;
}


// ==========================================
// MENSAGENS
// ==========================================

function mostrarErro(elemento, mensagem, campo) {

    elemento.textContent = mensagem;
    elemento.hidden = false;

    if (campo) {
        campo.setAttribute("aria-invalid", "true");
        campo.focus();
    }
}

function limparErro(elemento) {

    elemento.hidden = true;
    elemento.textContent = "";

    elemento.parentElement
        .querySelectorAll("[aria-invalid]")
        .forEach((campo) => campo.removeAttribute("aria-invalid"));
}

// Ao digitar de novo, tira a marca de erro do campo
document.querySelectorAll(".campo__entrada").forEach((campo) => {
    campo.addEventListener("input", () => campo.removeAttribute("aria-invalid"));
});

let temporizadorAviso = null;

function avisar(texto) {

    avisoCopiado.textContent = texto;
    avisoCopiado.hidden = false;

    clearTimeout(temporizadorAviso);

    temporizadorAviso = setTimeout(() => {
        avisoCopiado.hidden = true;
    }, 2200);
}

async function copiar(texto, mensagem) {

    try {

        await navigator.clipboard.writeText(texto);

    } catch (_) {

        // navegador sem permissão de área de transferência: tenta o jeito antigo
        const area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();

        try {
            document.execCommand("copy");
        } catch (_) {
            /* sem cópia automática */
        }

        area.remove();
    }

    avisar(mensagem || "Copiado!");
}


// ==========================================
// ABAS (Enviar / Receber / Minhas chaves)
// ==========================================

const ABAS = ["enviar", "receber", "chaves"];

function mostrarAba(nome, { focar = false, atualizarHash = true } = {}) {

    if (!ABAS.includes(nome)) {
        nome = "enviar";
    }

    ABAS.forEach((chave) => {

        const aba = $(`aba-${chave}`);
        const painel = $(`painel-${chave}`);
        const ativa = chave === nome;

        aba.setAttribute("aria-selected", String(ativa));
        aba.tabIndex = ativa ? 0 : -1;
        painel.hidden = !ativa;
    });

    if (focar) {
        $(`aba-${nome}`).focus();
    }

    if (atualizarHash && location.hash !== `#${nome}`) {
        history.replaceState(null, "", `${location.pathname}${location.search}#${nome}`);
    }
}

document.querySelectorAll(".aba").forEach((aba) => {

    aba.addEventListener("click", () => mostrarAba(aba.dataset.aba));

    // setas do teclado trocam de aba
    aba.addEventListener("keydown", (evento) => {

        const atual = ABAS.indexOf(aba.dataset.aba);
        let novo = null;

        if (evento.key === "ArrowRight") novo = (atual + 1) % ABAS.length;
        if (evento.key === "ArrowLeft") novo = (atual - 1 + ABAS.length) % ABAS.length;
        if (evento.key === "Home") novo = 0;
        if (evento.key === "End") novo = ABAS.length - 1;

        if (novo !== null) {
            evento.preventDefault();
            mostrarAba(ABAS[novo], { focar: true });
        }
    });
});

window.addEventListener("hashchange", () => {
    mostrarAba(location.hash.slice(1), { atualizarHash: false });
});


// ==========================================
// SALDO E USUÁRIO
// ==========================================

function atualizarSaldo() {
    saldoConta.textContent = formatarMoeda(saldoCentavos);
}

async function carregarConta() {

    const dados = await api("/api/home");

    saldoCentavos = Number(dados.saldo) || 0;
    atualizarSaldo();

    const nome = dados.nome || "Usuário";
    inicialUsuario.textContent = nome.charAt(0).toUpperCase();
}


// ==========================================
// ENVIAR PIX
// ==========================================

// Código "copia e cola" gerado na aba Receber: bcx-pix|chave|valor em centavos|nome
function interpretarCodigo(texto) {

    const partes = texto.trim().split("|");

    if (partes[0] !== "bcx-pix" || partes.length < 2 || !partes[1]) {
        return null;
    }

    const centavos = /^\d+$/.test(partes[2] || "") ? parseInt(partes[2], 10) : 0;

    return { chave: partes[1], centavos };
}

enviarChave.addEventListener("input", () => {

    const codigo = interpretarCodigo(enviarChave.value);

    dicaCodigo.hidden = !codigo;

    if (!codigo) {
        return;
    }

    enviarChave.value = codigo.chave;

    if (codigo.centavos > 0) {
        definirValor(enviarValor, codigo.centavos);
    }
});

enviarValor.addEventListener("input", () => aplicarMascara(enviarValor));
receberValor.addEventListener("input", () => aplicarMascara(receberValor));

function mostrarEtapaEnviar(etapa) {

    formEnviar.hidden = etapa !== "form";
    etapaConfirmar.hidden = etapa !== "confirmar";
    etapaComprovante.hidden = etapa !== "comprovante";

    if (etapa === "form") {
        enviarChave.focus();
    }

    if (etapa === "confirmar") {
        $("titulo-confirmar").focus();
    }

    if (etapa === "comprovante") {
        $("titulo-comprovante").focus();
    }
}

formEnviar.addEventListener("submit", (evento) => {

    evento.preventDefault();
    limparErro(erroEnviar);

    const chave = enviarChave.value.trim();
    const centavos = centavosDoCampo(enviarValor);
    const mensagem = enviarMensagem.value.trim();

    if (!chave) {
        return mostrarErro(erroEnviar, "Digite a chave Pix de quem vai receber.", enviarChave);
    }

    if (centavos <= 0) {
        return mostrarErro(erroEnviar, "Digite o valor do Pix.", enviarValor);
    }

    if (centavos > saldoCentavos) {
        return mostrarErro(
            erroEnviar,
            `Saldo insuficiente. Você tem ${formatarMoeda(saldoCentavos)} disponível.`,
            enviarValor
        );
    }

    pixPendente = { chave, centavos, mensagem };

    $("conf-valor").textContent = formatarMoeda(centavos);
    $("conf-chave").textContent = chave;
    $("conf-mensagem").textContent = mensagem;
    $("conf-mensagem-linha").hidden = !mensagem;

    limparErro(erroConfirmar);
    mostrarEtapaEnviar("confirmar");
});

btnVoltarForm.addEventListener("click", () => mostrarEtapaEnviar("form"));

btnConfirmar.addEventListener("click", async () => {

    if (!pixPendente) {
        return;
    }

    limparErro(erroConfirmar);

    btnConfirmar.disabled = true;
    btnVoltarForm.disabled = true;
    btnConfirmar.textContent = "Enviando…";

    try {

        const dados = await api("/api/pix/enviar", {
            metodo: "POST",
            corpo: {
                chave: pixPendente.chave,
                valor: centavosParaReaisTexto(pixPendente.centavos),
                descricao: pixPendente.mensagem
            }
        });

        saldoCentavos = Number(dados.saldo);
        atualizarSaldo();

        preencherComprovante(dados.comprovante);
        mostrarEtapaEnviar("comprovante");

        pixPendente = null;
        carregarHistorico();

    } catch (erro) {

        mostrarErro(erroConfirmar, erro.message);

    } finally {

        btnConfirmar.disabled = false;
        btnVoltarForm.disabled = false;
        btnConfirmar.textContent = "Confirmar Pix";
    }
});

function preencherComprovante(c) {

    $("comp-valor").textContent = formatarMoeda(c.valor);
    $("comp-data").textContent = formatarData(c.criado_em);
    $("comp-para").textContent = c.para;
    $("comp-chave").textContent = c.chave;
    $("comp-de").textContent = c.de;
    $("comp-mensagem").textContent = c.descricao || "";
    $("comp-mensagem-linha").hidden = !c.descricao;
    $("comp-id").textContent = c.id;
}

btnNovoPix.addEventListener("click", () => {

    formEnviar.reset();
    dicaCodigo.hidden = true;
    limparErro(erroEnviar);

    mostrarEtapaEnviar("form");
});


// ==========================================
// HISTÓRICO (últimos Pix)
// ==========================================

function tituloDoPix(t) {

    if (t.sinal === -1) {
        return t.contraparte ? `Pix enviado para ${t.contraparte}` : "Pix enviado";
    }

    return t.contraparte ? `Pix recebido de ${t.contraparte}` : "Pix recebido";
}

function criarLinhaPix(t) {

    const entrada = t.sinal === 1;

    const item = document.createElement("div");
    item.className = "transacao " + (entrada ? "transacao--entrada" : "transacao--saida");

    const info = document.createElement("div");
    info.className = "transacao__info";

    const titulo = document.createElement("p");
    titulo.className = "transacao__descricao";
    titulo.textContent = tituloDoPix(t);
    info.appendChild(titulo);

    if (t.descricao) {
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
    valor.textContent = `${entrada ? "+" : "−"} ${formatarMoeda(t.valor)}`;

    item.appendChild(info);
    item.appendChild(valor);

    return item;
}

function mensagemNaLista(texto, erro) {

    listaPix.replaceChildren();

    const caixa = document.createElement("div");
    caixa.className = "transacao transacao--vazia" + (erro ? " transacao--erro" : "");

    const p = document.createElement("p");
    p.textContent = texto;

    caixa.appendChild(p);
    listaPix.appendChild(caixa);
}

async function carregarHistorico() {

    try {

        const dados = await api("/api/extrato?limite=200");

        const pix = (dados.transacoes || [])
            .filter((t) => t.tipo === "pix")
            .slice(0, 10);

        if (pix.length === 0) {
            return mensagemNaLista("Nenhum Pix ainda.", false);
        }

        listaPix.replaceChildren(...pix.map(criarLinhaPix));

    } catch (erro) {

        if (erro.status !== 401) {
            mensagemNaLista("Não foi possível carregar seus Pix.", true);
        }
    }
}


// ==========================================
// RECEBER PIX
// ==========================================

function rotuloDaChave(c) {
    return `${NOMES_TIPO[c.tipo] || c.tipo} • ${formatarChave(c.tipo, c.chave)}`;
}

function preencherSelectReceber() {

    const escolhida = receberChave.value;

    receberChave.replaceChildren();

    if (chaves.length === 0) {

        const vazio = document.createElement("option");
        vazio.value = "";
        vazio.textContent = "Você não tem chaves cadastradas";
        receberChave.appendChild(vazio);
        receberChave.disabled = true;

        return;
    }

    receberChave.disabled = false;

    chaves.forEach((c) => {
        const opcao = document.createElement("option");
        opcao.value = c.id;
        opcao.textContent = rotuloDaChave(c);
        receberChave.appendChild(opcao);
    });

    if (chaves.some((c) => String(c.id) === escolhida)) {
        receberChave.value = escolhida;
    }
}

formReceber.addEventListener("submit", async (evento) => {

    evento.preventDefault();
    limparErro(erroReceber);

    const chaveId = parseInt(receberChave.value, 10);

    if (!Number.isInteger(chaveId)) {
        return mostrarErro(
            erroReceber,
            "Cadastre uma chave na aba Minhas chaves para receber Pix.",
            receberChave
        );
    }

    const centavos = centavosDoCampo(receberValor);
    const corpo = { chave_id: chaveId };

    if (centavos > 0) {
        corpo.valor = centavosParaReaisTexto(centavos);
    }

    const botao = formReceber.querySelector("button[type=submit]");
    botao.disabled = true;

    try {

        const dados = await api("/api/pix/cobranca", { metodo: "POST", corpo });

        ultimaCobranca = dados;

        cobrancaCodigo.textContent = dados.copia_e_cola;

        cobrancaResumo.textContent = dados.valor
            ? `Cobrança de ${formatarMoeda(dados.valor)} para a chave ${formatarChave(dados.tipo, dados.chave)}.`
            : `Sem valor definido: quem for pagar escolhe quanto enviar. Chave ${formatarChave(dados.tipo, dados.chave)}.`;

        resultadoCobranca.hidden = false;

    } catch (erro) {

        mostrarErro(erroReceber, erro.message);

    } finally {

        botao.disabled = false;
    }
});

btnCopiarCodigo.addEventListener("click", () => {
    if (ultimaCobranca) copiar(ultimaCobranca.copia_e_cola, "Código Pix copiado!");
});

btnCopiarChaveReceber.addEventListener("click", () => {
    if (ultimaCobranca) copiar(ultimaCobranca.chave, "Chave copiada!");
});


// ==========================================
// MINHAS CHAVES
// ==========================================

async function carregarChaves() {

    const dados = await api("/api/pix/chaves");

    chaves = dados.chaves || [];

    renderizarChaves();
    preencherSelectReceber();
}

function renderizarChaves() {

    listaChaves.replaceChildren();

    contagemChaves.textContent =
        chaves.length >= MAX_CHAVES
            ? `Você já cadastrou o máximo de ${MAX_CHAVES} chaves.`
            : `${chaves.length} de ${MAX_CHAVES} chaves cadastradas.`;

    formChave.hidden = chaves.length >= MAX_CHAVES;

    if (chaves.length === 0) {

        const vazio = document.createElement("li");
        vazio.className = "campo__dica";
        vazio.textContent = "Você ainda não tem chaves. Cadastre uma abaixo.";
        listaChaves.appendChild(vazio);

        return;
    }

    chaves.forEach((c) => listaChaves.appendChild(criarItemChave(c)));
}

function criarItemChave(c) {

    const item = document.createElement("li");
    item.className = "chave";

    const info = document.createElement("div");
    info.className = "chave__info";

    const tipo = document.createElement("p");
    tipo.className = "chave__tipo";
    tipo.textContent = NOMES_TIPO[c.tipo] || c.tipo;

    const valor = document.createElement("p");
    valor.className = "chave__valor";
    valor.textContent = formatarChave(c.tipo, c.chave);

    info.appendChild(tipo);
    info.appendChild(valor);

    const acoes = document.createElement("div");
    acoes.className = "chave__acoes";

    const btnCopiar = document.createElement("button");
    btnCopiar.type = "button";
    btnCopiar.className = "chave__botao";
    btnCopiar.textContent = "Copiar";
    btnCopiar.setAttribute("aria-label", `Copiar chave ${formatarChave(c.tipo, c.chave)}`);
    btnCopiar.addEventListener("click", () => copiar(c.chave, "Chave copiada!"));

    const btnExcluir = document.createElement("button");
    btnExcluir.type = "button";
    btnExcluir.className = "chave__botao chave__botao--perigo";
    btnExcluir.textContent = "Excluir";
    btnExcluir.setAttribute("aria-label", `Excluir chave ${formatarChave(c.tipo, c.chave)}`);
    btnExcluir.addEventListener("click", () => excluirChave(c, btnExcluir));

    acoes.appendChild(btnCopiar);
    acoes.appendChild(btnExcluir);

    item.appendChild(info);
    item.appendChild(acoes);

    return item;
}

// Exclusão em dois cliques: o primeiro pede confirmação, o segundo apaga
async function excluirChave(c, botao) {

    if (botao.dataset.confirmando !== "true") {

        botao.dataset.confirmando = "true";
        botao.textContent = "Confirmar?";

        setTimeout(() => {
            botao.dataset.confirmando = "false";
            botao.textContent = "Excluir";
        }, 4000);

        return;
    }

    botao.disabled = true;

    try {

        await api(`/api/pix/chaves/${c.id}`, { metodo: "DELETE" });

        if (ultimaCobranca && ultimaCobranca.chave === c.chave) {
            resultadoCobranca.hidden = true;
            ultimaCobranca = null;
        }

        await carregarChaves();
        avisar("Chave removida.");

    } catch (erro) {

        botao.disabled = false;
        avisar(erro.message);
    }
}

// O campo muda conforme o tipo escolhido
const CONFIG_TIPO = {
    email: { rotulo: "E-mail", placeholder: "voce@email.com", modo: "email" },
    cpf: { rotulo: "CPF", placeholder: "000.000.000-00", modo: "numeric" },
    telefone: { rotulo: "Telefone", placeholder: "(00) 00000-0000", modo: "tel" }
};

function ajustarCampoChave() {

    const tipo = chaveTipo.value;
    const aleatoria = tipo === "aleatoria";

    campoChaveValor.hidden = aleatoria;
    dicaAleatoria.hidden = !aleatoria;

    if (!aleatoria) {
        const cfg = CONFIG_TIPO[tipo];
        rotuloChaveValor.textContent = cfg.rotulo;
        chaveValor.placeholder = cfg.placeholder;
        chaveValor.inputMode = cfg.modo;
    }

    chaveValor.value = "";
    limparErro(erroChave);
}

chaveTipo.addEventListener("change", ajustarCampoChave);

formChave.addEventListener("submit", async (evento) => {

    evento.preventDefault();
    limparErro(erroChave);

    const tipo = chaveTipo.value;
    const corpo = { tipo };

    if (tipo !== "aleatoria") {

        const valor = chaveValor.value.trim();

        if (!valor) {
            return mostrarErro(erroChave, `Digite o ${CONFIG_TIPO[tipo].rotulo.toLowerCase()} da chave.`, chaveValor);
        }

        corpo.chave = valor;
    }

    const botao = formChave.querySelector("button[type=submit]");
    botao.disabled = true;

    try {

        await api("/api/pix/chaves", { metodo: "POST", corpo });

        chaveValor.value = "";
        await carregarChaves();
        avisar("Chave cadastrada!");

    } catch (erro) {

        mostrarErro(erroChave, erro.message, tipo === "aleatoria" ? null : chaveValor);

    } finally {

        botao.disabled = false;
    }
});


// ==========================================
// SAIR
// ==========================================

btnSair.addEventListener("click", async () => {

    try {

        await fetch("/api/logout", { method: "POST", credentials: "same-origin" });

    } catch (erro) {

        console.error("Erro ao sair:", erro);

    } finally {

        window.location.href = PAGINA_ENTRADA;
    }
});


// ==========================================
// INICIAR
// ==========================================

async function iniciar() {

    mostrarAba(location.hash.slice(1), { atualizarHash: false });
    ajustarCampoChave();

    try {

        await carregarConta();

    } catch (erro) {

        if (erro.status !== 401) {
            mostrarErro(erroEnviar, erro.message);
        }
    }

    carregarChaves().catch((erro) => {
        if (erro.status !== 401) {
            contagemChaves.textContent = erro.message;
        }
    });

    carregarHistorico();
}

document.addEventListener("DOMContentLoaded", iniciar);