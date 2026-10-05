// ==========================================
// BANCO CENTRALX - CARTÕES
// cartoes/cartoes.js
// ==========================================
// Todos os dados vêm da API (Flask + PostgreSQL):
//   GET  /api/home                          nome, saldo, agência e conta
//   GET  /api/cartoes                       cartões, patrimônio e regra do Black
//   GET  /api/cartoes/<id>/compras          compras do cartão
//   POST /api/cartoes/<id>/compra           compra no crédito (soma na fatura)
//   POST /api/cartoes/<id>/pagar-fatura     paga a fatura com o saldo da conta
//   POST /api/cartoes/<id>/bloquear         bloqueia / desbloqueia
//   POST /api/cartoes/<id>/limite           pede novo limite
//   POST /api/cartoes/black                 solicita o Black
//   POST /api/cartoes/debito/compra         compra no débito (rota nova, ver instruções)
//
// ATENÇÃO: a API devolve dinheiro em CENTAVOS. Ao enviar, convertemos para
// reais em texto ("1500.50"), que é o que o back.py espera.

const PAGINA_ENTRADA = "/entrada/entrada.html";
const ABAS = ["credito", "debito", "black"];

let dados = null;              // resposta combinada da API
let aba = "credito";
let numeroVisivel = false;     // mostrar número completo e CVV
let versaoTela = 0;            // evita que uma resposta antiga desenhe por cima da nova
let redirecionando = false;


// ==========================================
// ELEMENTOS
// ==========================================

const $ = (id) => document.getElementById(id);

const conteudo = $("conteudo-cartao");
const inicialUsuario = $("inicial-usuario");
const btnSair = $("botao-sair");
const avisoCopiado = $("aviso-copiado");

const modal = $("modal");
const modalForm = $("modal-form");
const modalTitulo = $("modal-titulo");
const modalApoio = $("modal-apoio");
const modalVisual = $("modal-visual");
const modalCampos = $("modal-campos");
const modalErro = $("modal-erro");
const modalOk = $("modal-ok");
const modalCancelar = $("modal-cancelar");


// ==========================================
// UTILIDADES
// ==========================================

// el("div", "classe", "texto") -> elemento
function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
}

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

function centavosParaReaisTexto(centavos) {
    return (centavos / 100).toFixed(2);
}

function agrupar(numero) {
    return String(numero).replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

// Máscara de dinheiro: a pessoa digita só números (1500 -> R$ 15,00)
function apenasDigitos(texto) {
    return String(texto).replace(/\D/g, "");
}

function aplicarMascara(campo) {
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

let temporizadorAviso = null;

function avisar(texto) {
    avisoCopiado.textContent = texto;
    avisoCopiado.hidden = false;

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
        avisoCopiado.hidden = true;
    }, 3200);
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
        if (!redirecionando) {
            redirecionando = true;
            window.location.href = PAGINA_ENTRADA;
        }
        throw new ErroApi("Sessão expirada. Entre novamente.", 401);
    }

    const corpoResposta = await resposta.json().catch(() => null);

    if (!resposta.ok || !corpoResposta || corpoResposta.ok === false) {
        throw new ErroApi(
            (corpoResposta && corpoResposta.erro) || "Algo deu errado. Tente de novo.",
            resposta.status
        );
    }

    return corpoResposta;
}


// ==========================================
// DESENHO DO CARTÃO (tudo em CSS, sem imagem do cartão)
// ==========================================

const SVG_NFC =
    '<svg viewBox="0 0 26 36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M3 11c3 4.6 3 9.4 0 14"/><path d="M9.5 7c4.6 7 4.6 15 0 22"/><path d="M16 3c6.4 9.4 6.4 21.6 0 31"/></svg>';

const SVG_CADEADO =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';

/*
  opcoes:
    tipo      "credito" | "debito" | "black"
    nome      nome do titular (vem da API)
    numero    número completo (só quando "Mostrar dados" está ligado)
    final     4 últimos dígitos
    linha     texto que substitui o número (usado no débito)
    validade  "MM/AA"
    bloqueado cartão bloqueado pelo usuário
    travado   Black ainda não liberado
    aviso     texto de apoio no cartão travado
*/
function visualCartao(opcoes) {

    const { tipo, nome, numero, final, linha, validade, bloqueado, travado, aviso } = opcoes;

    const cartao = el("div", `cartao cartao--${tipo}`);

    if (bloqueado) cartao.classList.add("cartao--bloqueado");
    if (travado) cartao.classList.add("cartao--travado");

    cartao.setAttribute("role", "img");
    cartao.setAttribute(
        "aria-label",
        `Cartão ${tipo === "black" ? "Black" : tipo === "debito" ? "de débito" : "de crédito"} Banco Centralx`
    );

    const agua = document.createElement("img");
    agua.className = "cartao__marca-agua";
    agua.src = "../imagens/logo-branca.png";
    agua.alt = "";
    cartao.appendChild(agua);

    const marca = document.createElement("img");
    marca.className = "cartao__marca";
    marca.src = "../imagens/logo-branca.png";
    marca.alt = "";
    cartao.appendChild(marca);

    const selo = el("div", "cartao__selo");
    if (tipo === "black") {
        selo.appendChild(el("strong", "", "BLACK"));
        selo.appendChild(el("em", "", "∞"));
        selo.appendChild(document.createTextNode("SEM LIMITE"));
    } else {
        selo.appendChild(el("strong", "", tipo === "debito" ? "DÉBITO" : "CRÉDITO"));
    }
    cartao.appendChild(selo);

    cartao.appendChild(el("div", "cartao__chip"));

    const nfc = el("div", "cartao__nfc");
    nfc.innerHTML = SVG_NFC; // SVG fixo, sem dados do usuário
    cartao.appendChild(nfc);

    let textoNumero = "•••• •••• •••• ••••";
    if (linha) textoNumero = linha;
    else if (numero) textoNumero = agrupar(numero);
    else if (final) textoNumero = `•••• •••• •••• ${final}`;
    cartao.appendChild(el("div", "cartao__numero", textoNumero));

    if (validade) {
        cartao.appendChild(el("div", "cartao__validade", `VÁLIDO ATÉ ${validade}`));
    }

    cartao.appendChild(el("div", "cartao__nome", nome || ""));

    const bandeira = el("div", "cartao__bandeira");
    bandeira.appendChild(document.createElement("i"));
    bandeira.appendChild(document.createElement("i"));
    cartao.appendChild(bandeira);

    if (bloqueado || travado) {
        const cobertura = el("div", "cartao__aviso");
        const icone = el("span");
        icone.innerHTML = SVG_CADEADO;
        cobertura.appendChild(icone);
        cobertura.appendChild(el("span", "", travado ? "BLACK BLOQUEADO" : "CARTÃO BLOQUEADO"));
        if (aviso) cobertura.appendChild(el("small", "", aviso));
        cartao.appendChild(cobertura);
    }

    return cartao;
}

// Cartão real (crédito / Black) da API -> opções do visual
function opcoesDoCartao(c, tipoVisual) {
    return {
        tipo: tipoVisual,
        nome: dados.nome.toUpperCase(),
        numero: numeroVisivel ? c.numero : null,
        final: c.final,
        validade: c.validade,
        bloqueado: c.bloqueado
    };
}

function opcoesDoDebito() {
    const conta = dados.conta ? `AG ${dados.agencia} · CC ${dados.conta}` : "";
    return { tipo: "debito", nome: dados.nome.toUpperCase(), linha: conta };
}


// ==========================================
// JANELA DE AÇÕES
// ==========================================
/*
  abrirModal({
    titulo, apoio, visual,
    campos: [{ id, rotulo, tipo: "dinheiro" | "texto", valor, placeholder, opcional }],
    rotuloOk,
    aoConfirmar: async (valores) => mensagemDeSucesso   // pode lançar Error para mostrar erro
  })
*/

let acaoModal = null;

function mostrarErroModal(mensagem, campo) {
    modalErro.textContent = mensagem;
    modalErro.hidden = false;

    if (campo) {
        campo.setAttribute("aria-invalid", "true");
        campo.focus();
    }
}

function abrirModal({ titulo, apoio, visual, campos, rotuloOk, aoConfirmar }) {

    modalTitulo.textContent = titulo;
    modalApoio.textContent = apoio || "";
    modalApoio.hidden = !apoio;

    modalVisual.replaceChildren();

    if (visual) {
        const caixa = el("div", "modal__visual");
        caixa.appendChild(visual);
        modalVisual.appendChild(caixa);
    }

    modalCampos.replaceChildren();
    modalErro.hidden = true;
    modalErro.textContent = "";

    const referencias = {};

    campos.forEach((c) => {

        const bloco = el("div", "campo");

        const rotulo = el("label", "campo__rotulo", c.rotulo);
        rotulo.htmlFor = `modal-${c.id}`;

        if (c.opcional) {
            rotulo.append(" ", el("span", "campo__opcional", "(opcional)"));
        }

        const entrada = document.createElement("input");
        entrada.className = "campo__entrada";
        entrada.id = `modal-${c.id}`;
        entrada.type = "text";
        entrada.autocomplete = "off";

        if (c.tipo === "dinheiro") {
            entrada.inputMode = "numeric";
            entrada.placeholder = "R$ 0,00";
            definirValor(entrada, c.valor || 0);
            entrada.addEventListener("input", () => aplicarMascara(entrada));
        } else {
            entrada.maxLength = 60;
            entrada.placeholder = c.placeholder || "";
            entrada.value = c.valor || "";
        }

        entrada.addEventListener("input", () => entrada.removeAttribute("aria-invalid"));

        bloco.append(rotulo, entrada);
        modalCampos.appendChild(bloco);

        referencias[c.id] = { entrada, tipo: c.tipo };
    });

    acaoModal = { referencias, aoConfirmar };

    modalOk.textContent = rotuloOk || "Confirmar";
    modalOk.disabled = false;

    modal.showModal();

    const primeira = modalCampos.querySelector("input");
    if (primeira) primeira.focus();
}

modalCancelar.addEventListener("click", () => modal.close());

modalForm.addEventListener("submit", async (evento) => {

    evento.preventDefault();

    if (!acaoModal) {
        return;
    }

    modalErro.hidden = true;

    const valores = {};

    Object.entries(acaoModal.referencias).forEach(([id, ref]) => {
        valores[id] = ref.tipo === "dinheiro"
            ? centavosDoCampo(ref.entrada)
            : ref.entrada.value.trim();
    });

    const textoOk = modalOk.textContent;
    modalOk.disabled = true;
    modalOk.textContent = "Aguarde…";

    let mensagem = null;
    let deuCerto = false;

    try {

        mensagem = await acaoModal.aoConfirmar(valores);
        deuCerto = true;

    } catch (erro) {

        if (erro.status !== 401) {
            mostrarErroModal(erro.message);
        }

    } finally {

        modalOk.disabled = false;
        modalOk.textContent = textoOk;
    }

    if (deuCerto) {
        modal.close();

        if (mensagem) {
            avisar(mensagem);
        }

        carregar().catch((erro) => avisar(erro.message));
    }
});


// ==========================================
// AÇÕES
// ==========================================

function acaoCompra(c, tipoVisual) {

    const debito = tipoVisual === "debito";

    abrirModal({
        titulo: debito ? "Compra no débito" : "Nova compra",
        apoio: debito
            ? `O valor sai do saldo na hora. Saldo: ${formatarMoeda(dados.saldo)}.`
            : "O valor entra na fatura deste cartão.",
        visual: visualCartao(debito ? opcoesDoDebito() : opcoesDoCartao(c, tipoVisual)),
        campos: [
            { id: "loja", rotulo: "Estabelecimento", tipo: "texto", placeholder: "Ex.: Mercado" },
            { id: "valor", rotulo: "Valor", tipo: "dinheiro" }
        ],
        rotuloOk: "Pagar",

        aoConfirmar: async (v) => {

            if (v.valor <= 0) {
                throw new Error("Digite o valor da compra.");
            }

            if (debito && v.valor > dados.saldo) {
                throw new Error(`Saldo insuficiente. Você tem ${formatarMoeda(dados.saldo)}.`);
            }

            const rota = debito
                ? "/api/cartoes/debito/compra"
                : `/api/cartoes/${c.id}/compra`;

            try {

                const r = await api(rota, {
                    metodo: "POST",
                    corpo: {
                        valor: centavosParaReaisTexto(v.valor),
                        estabelecimento: v.loja
                    }
                });

                return r.mensagem;

            } catch (erro) {

                if (debito && erro.status === 404) {
                    throw new Error(
                        "A rota /api/cartoes/debito/compra ainda não existe no back.py."
                    );
                }

                throw erro;
            }
        }
    });
}

function acaoPagarFatura(c, tipoVisual) {

    abrirModal({
        titulo: "Pagar fatura",
        apoio: `Fatura: ${formatarMoeda(c.fatura)}. Saldo em conta: ${formatarMoeda(dados.saldo)}. Você pode pagar só uma parte.`,
        visual: visualCartao(opcoesDoCartao(c, tipoVisual)),
        campos: [
            { id: "valor", rotulo: "Valor a pagar", tipo: "dinheiro", valor: c.fatura }
        ],
        rotuloOk: "Pagar fatura",

        aoConfirmar: async (v) => {

            if (v.valor <= 0) {
                throw new Error("Digite o valor do pagamento.");
            }

            if (v.valor > c.fatura) {
                throw new Error(`O valor é maior que a fatura (${formatarMoeda(c.fatura)}).`);
            }

            if (v.valor > dados.saldo) {
                throw new Error("Saldo insuficiente. Deposite na Home e tente de novo.");
            }

            const r = await api(`/api/cartoes/${c.id}/pagar-fatura`, {
                metodo: "POST",
                corpo: { valor: centavosParaReaisTexto(v.valor) }
            });

            return r.mensagem;
        }
    });
}

function acaoLimite(c, tipoVisual) {

    abrirModal({
        titulo: "Alterar limite",
        apoio: `Limite atual: ${formatarMoeda(c.limite)}. O máximo liberado para o seu perfil é ${formatarMoeda(c.limite_maximo_liberado)}. Ele cresce com o seu patrimônio.`,
        visual: visualCartao(opcoesDoCartao(c, tipoVisual)),
        campos: [
            { id: "valor", rotulo: "Novo limite", tipo: "dinheiro", valor: c.limite }
        ],
        rotuloOk: "Alterar limite",

        aoConfirmar: async (v) => {

            if (v.valor <= 0) {
                throw new Error("Digite o novo limite.");
            }

            const r = await api(`/api/cartoes/${c.id}/limite`, {
                metodo: "POST",
                corpo: { novo_limite: centavosParaReaisTexto(v.valor) }
            });

            return r.mensagem;
        }
    });
}

async function acaoBloquear(c, botao) {

    botao.disabled = true;

    try {

        const r = await api(`/api/cartoes/${c.id}/bloquear`, {
            metodo: "POST",
            corpo: { bloqueado: !c.bloqueado }
        });

        avisar(r.mensagem);
        await carregar();

    } catch (erro) {

        botao.disabled = false;

        if (erro.status !== 401) {
            avisar(erro.message);
        }
    }
}

async function acaoSolicitarBlack(botao) {

    botao.disabled = true;

    try {

        const r = await api("/api/cartoes/black", { metodo: "POST" });

        avisar(r.mensagem);
        await carregar();

    } catch (erro) {

        botao.disabled = false;

        if (erro.status !== 401) {
            avisar(erro.message);
        }
    }
}


// ==========================================
// LISTAS DE COMPRAS
// ==========================================

function linhaDeCompra(titulo, criadoEm, valor) {

    const item = el("div", "transacao transacao--saida");

    const info = el("div", "transacao__info");
    info.appendChild(el("p", "transacao__descricao", titulo));
    info.appendChild(el("p", "transacao__data", formatarData(criadoEm)));

    item.appendChild(info);
    item.appendChild(el("span", "transacao__valor", `− ${formatarMoeda(valor)}`));

    return item;
}

function mensagemNaLista(lista, texto, erro) {

    lista.replaceChildren();

    const caixa = el("div", "transacao transacao--vazia" + (erro ? " transacao--erro" : ""));
    caixa.appendChild(el("p", "", texto));

    lista.appendChild(caixa);
}

async function preencherComprasCartao(lista, c, versao) {

    try {

        const r = await api(`/api/cartoes/${c.id}/compras`);

        if (versao !== versaoTela) return;

        const compras = r.compras || [];

        if (compras.length === 0) {
            return mensagemNaLista(lista, "Nenhuma compra ainda. Use “Nova compra” para testar.", false);
        }

        lista.replaceChildren(
            ...compras.map((x) => linhaDeCompra(x.estabelecimento, x.criado_em, x.valor))
        );

    } catch (erro) {

        if (versao === versaoTela && erro.status !== 401) {
            mensagemNaLista(lista, "Não foi possível carregar as compras.", true);
        }
    }
}

// As compras no débito ficam no extrato como saída com descrição "Débito: loja"
async function preencherComprasDebito(lista, versao) {

    try {

        const r = await api("/api/extrato?tipo=saida&limite=200");

        if (versao !== versaoTela) return;

        const compras = (r.transacoes || [])
            .filter((t) => t.tipo === "saque" && String(t.descricao || "").startsWith("Débito:"))
            .slice(0, 20);

        if (compras.length === 0) {
            return mensagemNaLista(lista, "Nenhuma compra no débito ainda.", false);
        }

        lista.replaceChildren(
            ...compras.map((t) =>
                linhaDeCompra(t.descricao.replace(/^Débito:\s*/, ""), t.criado_em, t.valor)
            )
        );

    } catch (erro) {

        if (versao === versaoTela && erro.status !== 401) {
            mensagemNaLista(lista, "Não foi possível carregar as compras.", true);
        }
    }
}


// ==========================================
// TELAS
// ==========================================

function botao(texto, classe, aoClicar, opcoes = {}) {

    const b = el("button", `botao ${classe}`, texto);
    b.type = "button";

    if (opcoes.largo) b.classList.add("botao--largo");
    if (opcoes.desabilitado) b.disabled = true;
    if (opcoes.titulo) b.title = opcoes.titulo;

    b.addEventListener("click", () => aoClicar(b));

    return b;
}

function alternarDados() {
    numeroVisivel = !numeroVisivel;
    desenhar();
}

// Crédito e Black têm o mesmo painel: fatura, compras, pagar, bloquear
function desenharCartaoReal(raiz, c, tipoVisual) {

    const versao = versaoTela;
    const black = tipoVisual === "black";

    // ----- coluna do cartão -----
    const esquerda = el("div", "cartoes-col");

    esquerda.appendChild(visualCartao(opcoesDoCartao(c, tipoVisual)));

    const acoes = el("div", "cartao-acoes");

    acoes.appendChild(botao("Nova compra", "botao--principal", () => acaoCompra(c, tipoVisual), {
        desabilitado: c.bloqueado,
        titulo: c.bloqueado ? "Desbloqueie o cartão para comprar" : ""
    }));

    acoes.appendChild(botao("Pagar fatura", "botao--secundario", () => acaoPagarFatura(c, tipoVisual), {
        desabilitado: c.fatura <= 0,
        titulo: c.fatura <= 0 ? "Sem fatura em aberto" : ""
    }));

    acoes.appendChild(botao(
        c.bloqueado ? "Desbloquear" : "Bloquear",
        "botao--secundario",
        (b) => acaoBloquear(c, b)
    ));

    if (black) {
        acoes.appendChild(botao(
            numeroVisivel ? "Ocultar dados" : "Mostrar dados",
            "botao--secundario",
            alternarDados
        ));
    } else {
        acoes.appendChild(botao("Alterar limite", "botao--secundario", () => acaoLimite(c, tipoVisual)));
        acoes.appendChild(botao(
            numeroVisivel ? "Ocultar dados" : "Mostrar dados",
            "botao--secundario",
            alternarDados,
            { largo: true }
        ));
    }

    esquerda.appendChild(acoes);

    if (numeroVisivel) {
        esquerda.appendChild(el(
            "p",
            "cartao-dados",
            `Número ${agrupar(c.numero)} · Validade ${c.validade} · CVV ${c.cvv}`
        ));
    }

    // ----- coluna de resumo e compras -----
    const direita = el("div", "cartoes-col");

    const resumo = el("div", "resumo-cartao");

    if (black) {
        resumo.appendChild(el("span", "etiqueta-ouro", "Sem limite"));
    }

    resumo.appendChild(el("p", "resumo-cartao__rotulo", "Fatura atual"));
    resumo.appendChild(el("strong", "resumo-cartao__valor", formatarMoeda(c.fatura)));

    if (c.limite === null || c.limite === undefined) {

        resumo.appendChild(el(
            "p",
            "resumo-cartao__nota",
            "O Black não tem limite: compre à vontade e pague a fatura com o saldo da conta quando quiser."
        ));

    } else {

        const uso = c.limite > 0 ? Math.min(100, (c.fatura / c.limite) * 100) : 0;

        const barra = el("div", "barra" + (uso >= 90 ? " barra--cheia" : ""));
        barra.setAttribute("role", "img");
        barra.setAttribute("aria-label", `${Math.round(uso)}% do limite usado`);

        const preenchimento = el("span");
        preenchimento.style.width = `${uso}%`;
        barra.appendChild(preenchimento);
        resumo.appendChild(barra);

        const disponivel = el("div", "resumo-cartao__linha");
        disponivel.append(el("span", "", "Disponível"), el("strong", "", formatarMoeda(c.disponivel)));
        resumo.appendChild(disponivel);

        const total = el("div", "resumo-cartao__linha");
        total.append(el("span", "", "Limite total"), el("strong", "", formatarMoeda(c.limite)));
        resumo.appendChild(total);
    }

    direita.appendChild(resumo);

    direita.appendChild(el("h2", "", "Compras"));

    const lista = el("div", "transacoes");
    mensagemNaLista(lista, "Carregando…", false);
    direita.appendChild(lista);

    const grade = el("div", "cartoes-grade");
    grade.append(esquerda, direita);
    raiz.appendChild(grade);

    preencherComprasCartao(lista, c, versao);
}

function desenharDebito(raiz) {

    const versao = versaoTela;

    const esquerda = el("div", "cartoes-col");
    esquerda.appendChild(visualCartao(opcoesDoDebito()));

    const acoes = el("div", "cartao-acoes");
    acoes.appendChild(botao("Nova compra", "botao--principal", () => acaoCompra(null, "debito"), { largo: true }));
    esquerda.appendChild(acoes);

    const direita = el("div", "cartoes-col");

    const resumo = el("div", "resumo-cartao");
    resumo.appendChild(el("p", "resumo-cartao__rotulo", "Saldo disponível"));
    resumo.appendChild(el("strong", "resumo-cartao__valor", formatarMoeda(dados.saldo)));
    resumo.appendChild(el(
        "p",
        "resumo-cartao__nota",
        "O débito usa o saldo da conta corrente e a compra sai na hora, sem fatura."
    ));
    direita.appendChild(resumo);

    direita.appendChild(el("h2", "", "Compras no débito"));

    const lista = el("div", "transacoes");
    mensagemNaLista(lista, "Carregando…", false);
    direita.appendChild(lista);

    const grade = el("div", "cartoes-grade");
    grade.append(esquerda, direita);
    raiz.appendChild(grade);

    preencherComprasDebito(lista, versao);
}

function desenharBlackTravado(raiz) {

    const falta = Math.max(0, dados.blackMinimo - dados.patrimonio);
    const pct = dados.blackMinimo > 0
        ? Math.min(100, (dados.patrimonio / dados.blackMinimo) * 100)
        : 0;

    const esquerda = el("div", "cartoes-col");

    esquerda.appendChild(visualCartao({
        tipo: "black",
        nome: dados.nome.toUpperCase(),
        travado: true,
        aviso: `Libera com ${formatarMoeda(dados.blackMinimo)} de patrimônio`
    }));

    const direita = el("div", "cartoes-col");

    const resumo = el("div", "resumo-cartao");
    resumo.appendChild(el("span", "etiqueta-ouro", "Cartão Black"));
    resumo.appendChild(el("p", "resumo-cartao__rotulo", "Seu patrimônio"));
    resumo.appendChild(el("strong", "resumo-cartao__valor", formatarMoeda(dados.patrimonio)));

    const barra = el("div", "barra barra--ouro");
    barra.setAttribute("role", "img");
    barra.setAttribute("aria-label", `${Math.round(pct)}% da meta para o Black`);
    const preenchimento = el("span");
    preenchimento.style.width = `${pct}%`;
    barra.appendChild(preenchimento);
    resumo.appendChild(barra);

    const linhaFalta = el("div", "resumo-cartao__linha");
    linhaFalta.append(
        el("span", "", dados.blackElegivel ? "Meta atingida" : "Faltam"),
        el("strong", "", dados.blackElegivel ? formatarMoeda(dados.blackMinimo) : formatarMoeda(falta))
    );
    resumo.appendChild(linhaFalta);

    resumo.appendChild(el(
        "p",
        "resumo-cartao__nota",
        "O Black não tem limite. O patrimônio é o saldo da conta somado à poupança."
    ));

    direita.appendChild(resumo);

    const pedir = botao(
        dados.blackElegivel ? "Solicitar cartão Black" : "Ainda não disponível",
        "botao--principal",
        (b) => acaoSolicitarBlack(b),
        { desabilitado: !dados.blackElegivel }
    );
    pedir.style.maxWidth = "440px";
    direita.appendChild(pedir);

    const grade = el("div", "cartoes-grade");
    grade.append(esquerda, direita);
    raiz.appendChild(grade);
}

function desenhar() {

    if (!dados) {
        return;
    }

    versaoTela += 1;
    conteudo.replaceChildren();

    if (aba === "debito") {
        return desenharDebito(conteudo);
    }

    if (aba === "black") {
        const black = dados.cartoes.find((c) => c.tipo === "black");
        return black
            ? desenharCartaoReal(conteudo, black, "black")
            : desenharBlackTravado(conteudo);
    }

    const credito = dados.cartoes.find((c) => c.tipo === "padrao");

    if (!credito) {
        const vazio = el("div", "transacoes");
        mensagemNaLista(vazio, "Nenhum cartão de crédito encontrado nesta conta.", false);
        return conteudo.appendChild(vazio);
    }

    desenharCartaoReal(conteudo, credito, "credito");
}


// ==========================================
// ABAS
// ==========================================

function mostrarAba(nome, { focar = false, atualizarHash = true } = {}) {

    if (!ABAS.includes(nome)) {
        nome = "credito";
    }

    aba = nome;

    ABAS.forEach((chave) => {
        const botaoAba = $(`aba-${chave}`);
        const ativa = chave === nome;

        botaoAba.setAttribute("aria-selected", String(ativa));
        botaoAba.tabIndex = ativa ? 0 : -1;
    });

    conteudo.setAttribute("aria-labelledby", `aba-${nome}`);

    if (focar) {
        $(`aba-${nome}`).focus();
    }

    if (atualizarHash && location.hash !== `#${nome}`) {
        history.replaceState(null, "", `${location.pathname}${location.search}#${nome}`);
    }

    desenhar();
}

document.querySelectorAll(".aba").forEach((botaoAba) => {

    botaoAba.addEventListener("click", () => mostrarAba(botaoAba.dataset.aba));

    botaoAba.addEventListener("keydown", (evento) => {

        const atual = ABAS.indexOf(botaoAba.dataset.aba);
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
// CARREGAR
// ==========================================

async function carregar() {

    const [home, cartoes] = await Promise.all([
        api("/api/home"),
        api("/api/cartoes")
    ]);

    dados = {
        nome: home.nome || "Usuário",
        saldo: Number(home.saldo) || 0,
        agencia: home.agencia,
        conta: home.conta,
        cartoes: cartoes.cartoes || [],
        patrimonio: Number(cartoes.patrimonio) || 0,
        blackMinimo: Number(cartoes.black_minimo) || 0,
        blackElegivel: Boolean(cartoes.black_elegivel)
    };

    inicialUsuario.textContent = dados.nome.charAt(0).toUpperCase();

    desenhar();
}


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

    aba = ABAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "credito";
    mostrarAba(aba, { atualizarHash: false });

    try {

        await carregar();

    } catch (erro) {

        if (erro.status !== 401) {
            const caixa = el("div", "transacoes");
            mensagemNaLista(caixa, erro.message, true);
            conteudo.replaceChildren(caixa);
        }
    }
}

document.addEventListener("DOMContentLoaded", iniciar);