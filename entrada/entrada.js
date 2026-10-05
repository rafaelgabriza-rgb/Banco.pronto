/* Banco Centralx - tela de entrada: alterna entre "Entrar" e "Criar conta"
   e conversa com o back-end (back.py) pelas rotas /api/login e /api/cadastro. */

(() => {
  "use strict";

  // Para onde a pessoa vai depois de entrar (tela Home, próxima etapa do projeto)
  const DESTINO = "/home/";

  const RE_USUARIO = /^[a-z0-9_.]{3,20}$/;
  const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const $ = (seletor) => document.querySelector(seletor);
  const $$ = (seletor) => Array.from(document.querySelectorAll(seletor));

  const telas = {
    login: { form: $("#form-login"), rodape: $("#rodape-login"), titulo: "Entrar | Banco Centralx", hash: "" },
    cadastro: { form: $("#form-cadastro"), rodape: $("#rodape-cadastro"), titulo: "Criar conta | Banco Centralx", hash: "#criar-conta" },
  };

  // ---------- alternar entre as duas telas ----------

  function mostrar(nome, { focar = true, atualizarHash = true } = {}) {
    for (const [chave, tela] of Object.entries(telas)) {
      const ativa = chave === nome;
      tela.form.hidden = !ativa;
      tela.rodape.hidden = !ativa;
    }
    document.title = telas[nome].titulo;
    limparErros();
    if (atualizarHash && location.hash !== telas[nome].hash) {
      history.pushState(null, "", location.pathname + location.search + telas[nome].hash);
    }
    if (focar) {
      const primeiro = telas[nome].form.querySelector("input");
      if (primeiro) primeiro.focus();
    }
    window.scrollTo({ top: 0 });
  }

  function telaDoHash() {
    return location.hash === "#criar-conta" ? "cadastro" : "login";
  }

  $$("[data-ir]").forEach((botao) => {
    botao.addEventListener("click", () => mostrar(botao.dataset.ir));
  });

  window.addEventListener("popstate", () => mostrar(telaDoHash(), { atualizarHash: false }));

  // ---------- mostrar / ocultar senha ----------

  $$(".campo__ver").forEach((botao) => {
    botao.addEventListener("click", () => {
      const campo = document.getElementById(botao.dataset.alvo);
      const mostrando = campo.type === "text";
      campo.type = mostrando ? "password" : "text";
      botao.textContent = mostrando ? "Mostrar" : "Ocultar";
      botao.setAttribute("aria-pressed", String(!mostrando));
    });
  });

  // ---------- erros ----------

  function limparErros() {
    $$(".erro").forEach((el) => { el.hidden = true; el.textContent = ""; });
    $$(".campo__entrada").forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function mostrarErro(idErro, mensagem, campo) {
    const el = document.getElementById(idErro);
    el.textContent = mensagem;
    el.hidden = false;
    if (campo) {
      campo.setAttribute("aria-invalid", "true");
      campo.focus();
    }
  }

  // Ao digitar de novo, tira a marca de erro do campo
  $$(".campo__entrada").forEach((campo) => {
    campo.addEventListener("input", () => campo.removeAttribute("aria-invalid"));
  });

  // ---------- conversa com o servidor ----------

  async function enviar(rota, corpo) {
    let resposta;
    try {
      resposta = await fetch(rota, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
    } catch (_) {
      throw new Error(
        "Não foi possível falar com o servidor. Rode o back.py e abra o site em http://127.0.0.1:5000."
      );
    }
    let dados = {};
    try { dados = await resposta.json(); } catch (_) { /* resposta sem JSON */ }
    if (!resposta.ok || dados.ok === false) {
      throw new Error(dados.erro || "Algo deu errado. Tente de novo.");
    }
    return dados;
  }

  function ocupado(form, sim, textoOcupado) {
    const botao = form.querySelector("button[type=submit]");
    if (sim) botao.dataset.texto = botao.textContent;
    botao.disabled = sim;
    botao.setAttribute("aria-busy", String(sim));
    botao.textContent = sim ? textoOcupado : botao.dataset.texto;
  }

  // ---------- entrar ----------

  telas.login.form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros();
    const usuario = $("#login-usuario");
    const senha = $("#login-senha");

    if (!usuario.value.trim()) return mostrarErro("erro-login", "Digite seu usuário.", usuario);
    if (!senha.value) return mostrarErro("erro-login", "Digite sua senha.", senha);

    ocupado(telas.login.form, true, "Entrando…");
    try {
      await enviar("/api/login", { username: usuario.value.trim().toLowerCase(), senha: senha.value });
      location.assign(DESTINO);
    } catch (erro) {
      ocupado(telas.login.form, false);
      mostrarErro("erro-login", erro.message, senha);
      senha.select();
    }
  });

  // ---------- criar conta ----------

  telas.cadastro.form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limparErros();
    const nome = $("#cad-nome");
    const usuario = $("#cad-usuario");
    const email = $("#cad-email");
    const senha = $("#cad-senha");
    const confirmar = $("#cad-confirmar");
    const nomeUsuario = usuario.value.trim().toLowerCase();

    const falhas = [
      [nome.value.trim().length < 2, nome, "Digite seu nome completo."],
      [!RE_USUARIO.test(nomeUsuario), usuario, "Usuário: 3 a 20 caracteres, só letras minúsculas, números, _ ou ."],
      [!RE_EMAIL.test(email.value.trim()), email, "Digite um e-mail válido."],
      [senha.value.length < 6, senha, "A senha precisa ter pelo menos 6 caracteres."],
      [confirmar.value !== senha.value, confirmar, "As senhas não são iguais."],
    ];
    const primeira = falhas.find(([falhou]) => falhou);
    if (primeira) return mostrarErro("erro-cadastro", primeira[2], primeira[1]);

    ocupado(telas.cadastro.form, true, "Criando conta…");
    try {
      await enviar("/api/cadastro", {
        nome: nome.value.trim(),
        username: nomeUsuario,
        email: email.value.trim().toLowerCase(),
        senha: senha.value,
      });
      location.assign(DESTINO);
    } catch (erro) {
      ocupado(telas.cadastro.form, false);
      mostrarErro("erro-cadastro", erro.message);
    }
  });

  // ---------- ao abrir a página ----------

  mostrar(telaDoHash(), { focar: false, atualizarHash: false });

  // Se a pessoa já estiver logada, vai direto para a Home
  fetch("/api/eu", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then((dados) => { if (dados && dados.ok) location.replace(DESTINO); })
    .catch(() => { /* aberto sem servidor: só mostra a tela */ });
})();