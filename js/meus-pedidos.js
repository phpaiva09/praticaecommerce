function buscarImagemDinamica(nomeProduto, cor) {
  if (!nomeProduto) return "img/placeholder.png";

  const nomeFormatado = nomeProduto.toLowerCase().trim();
  const corFormatada = cor ? cor.toLowerCase().trim() : "";

  // PRODUTO 1: Mesa Carrinho Para Vapor...
  if (nomeFormatado.includes("mesa carrinho para vapor")) {
    if (corFormatada === "preto") {
      return "img/produtopreto.webp";
    }
    return "img/produto1.png"; // Branco
  }

  // PRODUTO 2: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("carrinho móvel para gerador")) {
    if (corFormatada === "preto") {
      return "img/produto2.png";
    }
    return "img/produto2-2.webp"; // Branco
  }

  // PRODUTO 3: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("carrinho suporte auxiliar")) {
    if (corFormatada === "preto") {
      return "img/produto3.png";
    }
    return "img/produto3-4.webp"; // Branco
  }

  // PRODUTO 4: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("carrinho móvel para ozonioterapia")) {
    if (corFormatada === "branco") {
      return "img/produto4.png";
    }
    return "img/produto4.png"; // Branco
  }

  // PRODUTO 5: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("mesa com rodízios com trava para notebook tablet projetor")) {
    if (corFormatada === "preto") {
      return "img/produto5-1.png";
    }
    return "img/produto5-4.webp"; // Branco
  }

  // PRODUTO 6: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("carrinho vapor de ozônio rodízio com trava")) {
    if (corFormatada === "preto") {
      return "img/produtopreto.webp";
    }
    return "img/produto1.png"; // Branco
  }

  // PRODUTO 7: Carrinho Móvel Para Gerador... (O que não estava funcionando)
  if (nomeFormatado.includes("carrinho para vapor de ozônio alto")) {
    if (corFormatada === "preto") {
      return "img/produto7-1.webp";
    }
    return "img/produto7.webp"; // Branco
  }

  return "img/placeholder.png";
}

const usuarioId = localStorage.getItem("usuarioId");

if (!usuarioId) {
  window.location.href = "telalogin.html";
}

const container = document.getElementById("lista-pedidos");

async function pagarPedido(pedidoId, valorDoPedido) {
  try {
    localStorage.removeItem("pedidoId");

    const res = await fetch(`https://pratica-api.onrender.com/pedido/${pedidoId}/pix`, {
      method: "POST"
    });

    const data = await res.json();

    if (!data.sucesso) {
      alert(data.msg || "Erro ao gerar pagamento");
      return;
    }

    // 🔥 Aqui você decide o fluxo
    // Opção 1: salvar no localStorage e ir pra tela PIX

    localStorage.setItem("pixPedido", JSON.stringify({
      pedidoId,
      qrCode: data.qrCode,
      valor: valorDoPedido,
      qrBase64: data.qrBase64
    }));

    window.location.href = "checkout-pagamento.html";

  } catch (err) {
    console.error(err);
    alert("Erro ao iniciar pagamento");
  }
}


async function carregarPedidos() {
  try {
    const res = await fetch(`https://pratica-api.onrender.com/meus-pedidos/${usuarioId}`);
    const pedidos = await res.json();

    container.innerHTML = "";

    if (!pedidos.length) {
      container.innerHTML = "<p>Nenhum pedido encontrado</p>";
      return;
    }

    pedidos.forEach(pedido => {

      const botaoCancelar = pedido.status === "pendente"
        ? `<button class="btn-cancelar-pedido" onclick="cancelarPedido(${pedido.id})">
        Cancelar pedido
     </button>`
        : "";

      const botaoReembolso = pedido.status === "pago"
        ? `<button class="btn-reembolso" onclick="solicitarReembolso(${pedido.id})">
        Solicitar reembolso
     </button>`
        : "";

      const botaoPagamento = pedido.status === "pendente"
        ? `<button class="btn-pagar" onclick="pagarPedido(${pedido.id}, ${pedido.valor})">
        Pagar pedido
     </button>`
        : "";

      const mensagemSolicitada = pedido.status === "reembolso_solicitado"
        ? `<p class="mensagem-suporte">Sua solicitação de reembolso foi recebida e está aguardando análise do administrador.</p>`
        : "";

      const mensagemReembolsado = pedido.status === "reembolsado"
        ? `<p class="mensagem-suporte">Este pedido já foi reembolsado.</p>`
        : "";

      const mensagemRecusado = pedido.status === "reembolso_recusado"
        ? `<p class="mensagem-suporte">A solicitação de reembolso foi recusada.</p>`
        : "";
      const div = document.createElement("div");
      div.classList.add("pedido");

      div.innerHTML = `
        <div class="pedido-header">
          <strong>Pedido #${pedido.id}</strong>
          <span>Status: <strong>${pedido.status}</strong></span>
          <span>Total: R$ ${pedido.valor}</span>
        </div>

        ${botaoPagamento}
        ${botaoCancelar}
        ${botaoReembolso}
        ${mensagemSolicitada}
        ${mensagemReembolsado}
        ${mensagemRecusado}

        <details>
                  <summary>Ver itens</summary>
                  ${pedido.itens.map(item => {
        // 🔥 ESSA LINHA É A CHAVE: Criamos a variável antes de usar no HTML
        const imagemCorreta = buscarImagemDinamica(item.produto_nome, item.cor);

        return `
                      <div class="item-pedido">
                        <div class="pedido-img">
                          <img src="${imagemCorreta}" alt="${item.produto_nome}">
                        </div>

                        <div class="item-info">
                          <span>${item.produto_nome || 'Produto'} | ${item.cor} | ${item.quantidade}x</span>
                        </div>
                      </div>
                    `;
      }).join("")}
                </details>
            `;

      container.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    container.innerHTML = "<p>Erro ao carregar pedidos.</p>";
  }
}

// ✅ PRIMEIRA CARGA
carregarPedidos();

// ✅ ATUALIZA AUTOMÁTICA A CADA 5s
setInterval(() => {
  carregarPedidos();
}, 10000);
