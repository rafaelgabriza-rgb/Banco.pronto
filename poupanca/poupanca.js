
// ==========================================
// BANCO CENTRALX - POUPANÇA
// ==========================================

document.addEventListener("DOMContentLoaded", () => {

    // ==========================================
    // ELEMENTOS
    // ==========================================

    const saldoPoupanca = document.getElementById("saldo-poupanca");
    const rendimentoAcumulado = document.getElementById("rendimento-acumulado");
    const rendimentoDiario = document.getElementById("rendimento-diario");
    const listaPoupanca = document.getElementById("lista-poupanca");

    const btnDepositar = document.getElementById("btn-depositar");
    const btnRetirar = document.getElementById("btn-retirar");

    const modal = document.getElementById("modal");
    const fecharModal = document.getElementById("fechar-modal");
    const confirmarOperacao = document.getElementById("confirmar-operacao");

    const valorInput = document.getElementById("valor");

    // CORRETO: o HTML usa modal-titulo
    const tituloModal = document.getElementById("modal-titulo");

    const subtituloModal = document.getElementById("modal-subtitulo");
    const descricaoModal = document.getElementById("modal-descricao");
    const mensagem = document.getElementById("mensagem");


    // ==========================================
    // OPERAÇÃO ATUAL
    // ==========================================

    let operacaoAtual = null;


    // ==========================================
    // VALOR DIGITADO EM CENTAVOS
    //
    // 2      = R$ 0,02
    // 20     = R$ 0,20
    // 200    = R$ 2,00
    // 2000   = R$ 20,00
    // 125050 = R$ 1.250,50
    // ==========================================

    let valorCentavosDigitado = 0;


    // ==========================================
    // MOEDA
    // ==========================================

    function formatarMoedaCentavos(valor) {

        const numero = Number(valor || 0);

        if (!Number.isFinite(numero)) {
            return "R$ 0,00";
        }

        return (numero / 100).toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL"
        });
    }


    function formatarEntradaCentavos(valor) {

        const numero = Number(valor || 0);

        return (numero / 100).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }


    // ==========================================
    // CAMPO DE VALOR
    // ==========================================

    function atualizarCampoValor() {

        valorInput.value =
            formatarEntradaCentavos(
                valorCentavosDigitado
            );
    }


    function limparValor() {

        valorCentavosDigitado = 0;

        atualizarCampoValor();
    }


    function adicionarDigito(digito) {

        if (!/^\d$/.test(digito)) {
            return;
        }

        const limiteMaximo = 10000000000;

        const novoValor =
            valorCentavosDigitado * 10 +
            Number(digito);

        if (novoValor > limiteMaximo) {

            mensagem.textContent =
                "O valor máximo por operação é R$ 100.000.000,00.";

            return;
        }

        valorCentavosDigitado = novoValor;

        atualizarCampoValor();

        mensagem.textContent = "";
    }


    function removerUltimoDigito() {

        valorCentavosDigitado =
            Math.floor(
                valorCentavosDigitado / 10
            );

        atualizarCampoValor();

        mensagem.textContent = "";
    }


    // ==========================================
    // TECLADO
    // ==========================================

    valorInput.addEventListener(
        "keydown",
        (evento) => {

            // Números
            if (/^\d$/.test(evento.key)) {

                evento.preventDefault();

                adicionarDigito(evento.key);

                return;
            }


            // Backspace
            if (evento.key === "Backspace") {

                evento.preventDefault();

                removerUltimoDigito();

                return;
            }


            // Delete
            if (evento.key === "Delete") {

                evento.preventDefault();

                limparValor();

                return;
            }


            // Teclas permitidas
            if (
                evento.key === "Tab" ||
                evento.key === "Shift" ||
                evento.key === "Control" ||
                evento.key === "Alt" ||
                evento.key === "Escape" ||
                evento.key === "ArrowLeft" ||
                evento.key === "ArrowRight" ||
                evento.key === "Home" ||
                evento.key === "End"
            ) {
                return;
            }


            // Bloqueia qualquer outro caractere
            evento.preventDefault();
        }
    );


    // ==========================================
    // COLAR
    // ==========================================

    valorInput.addEventListener(
        "paste",
        (evento) => {

            evento.preventDefault();

            const texto =
                evento.clipboardData
                    ?.getData("text") || "";

            const numeros =
                texto.replace(/\D/g, "");

            if (!numeros) {
                return;
            }

            for (const digito of numeros) {

                const novoValor =
                    valorCentavosDigitado * 10 +
                    Number(digito);

                if (novoValor > 10000000000) {
                    break;
                }

                valorCentavosDigitado =
                    novoValor;
            }

            atualizarCampoValor();
        }
    );


    // ==========================================
    // VALOR EM REAIS
    // ==========================================

    function obterValorEmReais() {

        return valorCentavosDigitado / 100;
    }


    // ==========================================
    // ABRIR MODAL
    // ==========================================

    function abrirModal(tipo) {

        operacaoAtual = tipo;

        limparValor();

        mensagem.textContent = "";


        if (tipo === "guardar") {

            subtituloModal.textContent =
                "Guardar dinheiro";

            tituloModal.textContent =
                "Adicionar à poupança";

            descricaoModal.textContent =
                "Informe quanto deseja transferir da sua conta para a poupança.";

            confirmarOperacao.textContent =
                "Guardar dinheiro";
        }


        if (tipo === "resgatar") {

            subtituloModal.textContent =
                "Retirar dinheiro";

            tituloModal.textContent =
                "Retirar da poupança";

            descricaoModal.textContent =
                "Informe quanto deseja transferir da poupança para sua conta.";

            confirmarOperacao.textContent =
                "Retirar dinheiro";
        }


        // IMPORTANTE:
        // Remove "escondido" porque o CSS usa !important.
        modal.classList.remove("escondido");

        // Adiciona o estado visual aberto
        modal.classList.add("ativo");


        setTimeout(() => {

            valorInput.focus();

        }, 50);
    }


    // ==========================================
    // FECHAR MODAL
    // ==========================================

    function fecharModalFuncao() {

        modal.classList.remove("ativo");

        // IMPORTANTE:
        // Coloca escondido novamente.
        modal.classList.add("escondido");

        operacaoAtual = null;

        limparValor();

        mensagem.textContent = "";
    }


    // ==========================================
    // BOTÃO GUARDAR
    // ==========================================

    if (btnDepositar) {

        btnDepositar.addEventListener(
            "click",
            () => {

                abrirModal("guardar");

            }
        );
    }


    // ==========================================
    // BOTÃO RETIRAR
    // ==========================================

    if (btnRetirar) {

        btnRetirar.addEventListener(
            "click",
            () => {

                abrirModal("resgatar");

            }
        );
    }


    // ==========================================
    // FECHAR
    // ==========================================

    if (fecharModal) {

        fecharModal.addEventListener(
            "click",
            fecharModalFuncao
        );
    }


    // Clicar fora do modal
    if (modal) {

        modal.addEventListener(
            "click",
            (evento) => {

                if (evento.target === modal) {

                    fecharModalFuncao();

                }
            }
        );
    }


    // ESC
    document.addEventListener(
        "keydown",
        (evento) => {

            if (
                evento.key === "Escape" &&
                modal &&
                !modal.classList.contains("escondido")
            ) {

                fecharModalFuncao();

            }
        }
    );


    // ==========================================
    // CARREGAR POUPANÇA
    // ==========================================

    async function carregarPoupanca() {

        try {

            const resposta =
                await fetch(
                    "/api/poupanca",
                    {
                        method: "GET",
                        credentials: "same-origin",
                        cache: "no-store"
                    }
                );


            if (resposta.status === 401) {

                window.location.href =
                    "/entrada/entrada.html";

                return;
            }


            const dados =
                await resposta.json();


            if (
                !resposta.ok ||
                !dados ||
                dados.ok === false
            ) {

                throw new Error(
                    dados?.erro ||
                    "Não foi possível carregar a poupança."
                );
            }


            // ==========================================
            // SALDO DA POUPANÇA
            // ==========================================
            //
            // IMPORTANTE:
            // NÃO usamos dados.saldo aqui.
            //
            // saldo = dinheiro na conta
            // poupanca = dinheiro guardado
            //

            saldoPoupanca.textContent =
                formatarMoedaCentavos(
                    dados.poupanca ?? 0
                );


            // ==========================================
            // RENDIMENTO
            // ==========================================

            // Seu backend atualmente fornece
            // somente o percentual diário.
            //
            // Ele não fornece um campo separado
            // chamado rendimento_acumulado.
            //
            // Portanto não inventamos esse valor.

            if (rendimentoAcumulado) {

                rendimentoAcumulado.textContent =
                    "—";

            }


            if (rendimentoDiario) {

                const percentual =
                    Number(
                        dados.rendimento_diario_percentual ?? 0
                    );

                rendimentoDiario.textContent =
                    percentual.toLocaleString(
                        "pt-BR",
                        {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                        }
                    ) + "% ao dia";
            }


        } catch (erro) {

            console.error(
                "Erro ao carregar poupança:",
                erro
            );


            if (saldoPoupanca) {

                saldoPoupanca.textContent =
                    "R$ 0,00";
            }

        }
    }


    // ==========================================
    // CONFIRMAR OPERAÇÃO
    // ==========================================

    if (confirmarOperacao) {

        confirmarOperacao.addEventListener(
            "click",
            async () => {

                const valorEmReais =
                    obterValorEmReais();


                // Não aceita zero
                if (valorEmReais <= 0) {

                    mensagem.textContent =
                        "Digite um valor maior que zero.";

                    return;
                }


                if (!operacaoAtual) {
                    return;
                }


                confirmarOperacao.disabled = true;

                mensagem.textContent =
                    "Processando...";


                try {

                    const endpoint =
                        operacaoAtual === "guardar"
                            ? "/api/poupanca/guardar"
                            : "/api/poupanca/resgatar";


                    const resposta =
                        await fetch(
                            endpoint,
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                credentials:
                                    "same-origin",

                                body:
                                    JSON.stringify({
                                        valor:
                                            valorEmReais.toFixed(2)
                                    })
                            }
                        );


                    const resultado =
                        await resposta
                            .json()
                            .catch(() => null);


                    if (
                        !resposta.ok ||
                        !resultado ||
                        resultado.ok === false
                    ) {

                        throw new Error(
                            resultado?.erro ||
                            resultado?.mensagem ||
                            "Não foi possível realizar a operação."
                        );
                    }


                    mensagem.textContent =
                        resultado.mensagem ||
                        "Operação realizada com sucesso.";


                    // ==========================================
                    // ATUALIZA IMEDIATAMENTE O SALDO
                    // ==========================================

                    if (
                        resultado.poupanca !==
                        undefined
                    ) {

                        saldoPoupanca.textContent =
                            formatarMoedaCentavos(
                                resultado.poupanca
                            );
                    }


                    // ==========================================
                    // RECARREGA OS DADOS
                    // ==========================================

                    await carregarPoupanca();


                    // Fecha depois de mostrar sucesso
                    setTimeout(
                        () => {
                            fecharModalFuncao();
                        },
                        700
                    );


                } catch (erro) {

                    console.error(
                        "Erro na operação:",
                        erro
                    );


                    mensagem.textContent =
                        erro.message ||
                        "Não foi possível realizar a operação.";


                } finally {

                    confirmarOperacao.disabled =
                        false;

                }

            }
        );
    }


    // ==========================================
    // INICIAR
    // ==========================================

    limparValor();

    carregarPoupanca();

});

