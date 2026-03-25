// === Abrir e Fechar o Carrinho (com persistência entre páginas) ===
const cartIcon = document.querySelector('.shop');
const cartContainer = document.querySelector('.cart-container');
const closeCart = document.querySelector('.close-cart');

// Recupera o estado salvo do carrinho (aberto ou fechado)
let cartOpen = localStorage.getItem('cartOpen') === 'true';

// Atualiza a visibilidade do carrinho conforme o estado salvo
function updateCartVisibility() {
  if (cartOpen) {
    cartContainer.classList.add('active');
  } else {
    cartContainer.classList.remove('active');
  }
}

// Alterna visibilidade ao clicar no ícone da sacola
if (cartIcon) {
  cartIcon.addEventListener('click', () => {
    cartOpen = !cartOpen;
    localStorage.setItem('cartOpen', cartOpen);
    updateCartVisibility();
  });
}

// Fecha o carrinho ao clicar no "X"
if (closeCart) {
  closeCart.addEventListener('click', () => {
    cartOpen = false;
    localStorage.setItem('cartOpen', 'false');
    updateCartVisibility();
  });
}

// Aplica o estado salvo do carrinho ao carregar a página
updateCartVisibility();

// === Estrutura do Carrinho ===
let cart = [];

// Elementos
const addToCartBtn = document.querySelector('.add-to-cart');
const cartItemsContainer = document.querySelector('.cart-items');
const checkoutBtn = document.getElementById('checkout-btn');
const cartTotalElement = document.getElementById('cart-total');

// === Restaura o carrinho salvo (se houver) ===
const savedCart = localStorage.getItem('cart');
if (savedCart) {
  cart = JSON.parse(savedCart);
  updateCart();
}

// === Função: Atualizar Carrinho na Tela ===
function updateCart() {
  if (!cartItemsContainer) return;

  cartItemsContainer.innerHTML = '';

  cart.forEach((item, index) => {
    const div = document.createElement('div');
    div.classList.add('cart-item');

    div.innerHTML = `
      <img src="${item.image}" alt="${item.name}" width="60">
      <div class="item-info">
        <p>${item.name}</p>
        <p>Cor: ${item.cor}</p>
        <p>R$ ${item.preco.toFixed(2)}</p>
      </div>
      <div class="item-actions">
        <button class="decrease" data-index="${index}">-</button>
        <span>${item.quantidade}</span>
        <button class="increase" data-index="${index}">+</button>
        <button class="remove" data-index="${index}"> 
          <img src="img/lixo.png" alt="Remover" width="30" height="30"> 
        </button>
      </div>
    `;

    cartItemsContainer.appendChild(div);
  });

  // 🔥 Calcula total do carrinho
  let total = 0;
  cart.forEach(item => {
    total += item.preco * item.quantidade;
  });

  cartTotalElement.textContent = total.toFixed(2);

  localStorage.setItem('cartTotal', total);

  localStorage.setItem('cart', JSON.stringify(cart));
  addCartEventListeners();
}

// === Botões de incremento, decremento e remoção de itens do carrinho ===
function addCartEventListeners() {
  document.querySelectorAll('.increase').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.index;
      cart[i].quantidade++;
      updateCart();
    });
  });

  document.querySelectorAll('.decrease').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.index;
      if (cart[i].quantidade > 1) {
        cart[i].quantidade--;
      } else {
        cart.splice(i, 1);
      }
      updateCart();
    });
  });

  document.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.index;
      cart.splice(i, 1);
      updateCart();
    });
  });
}


// === Verificação de Login e Adicionar ao Carrinho ===
if (addToCartBtn) {
  addToCartBtn.addEventListener('click', () => {

  let isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

  if (!isLoggedIn) {
    mostrarAvisoLogin();
    window.location.href = "telalogin.html";
    return;
  }

  const produtoId = parseInt(
    document.querySelector('.add-to-cart').dataset.produtoId
  );

  const cor = document.getElementById('corSelecionada')?.textContent || '';

  if (!cor) {
    alert('Selecione uma cor');
    return;
  }

  // 🔥 AQUI entra o preço
  const precoTexto = document.querySelector('.preco').textContent;
  const preco = parseFloat(
    precoTexto.replace('R$', '').replace('.', '').replace(',', '.')
  );

  const nomeProduto = document.querySelector('h2').textContent;

  const imagem = document.getElementById('imagemPrincipal')?.src || '';

  const produtoExistente = cart.find(
    item => item.produto_id === produtoId && item.cor === cor
  );

  if (produtoExistente) {
    produtoExistente.quantidade++;
  } else {
    cart.push({
      produto_id: produtoId,
      quantidade: 1,
      cor: cor,
      preco: preco,
      name: nomeProduto,
      image: imagem
    });
  }

  updateCart();

  cartContainer.classList.add('active');
  cartOpen = true;
  localStorage.setItem('cartOpen', 'true');
});
}

// === Finalizar Compra ===
checkoutBtn.addEventListener('click', () => {
  if (cart.length === 0) {
    alert("Seu carrinho está vazio!");
    return;
  }

  // 🔹 Salva o carrinho ANTES de ir pra página de endereço
  localStorage.setItem("cart", JSON.stringify(cart));

  // 🔹 Vai para a tela de endereço/pagamento
  window.location.href = "checkout-endereco.html";
});


// === Atualiza navbar com usuário logado ===
window.addEventListener("load", () => {
  const userNav = document.getElementById('user-nav');

  // Pega dados do usuário do localStorage
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const usuarioLogin = localStorage.getItem('usuarioLogin');

  if (isLoggedIn && usuarioLogin) {
    // Mostra "Olá, Usuário | Sair"
    userNav.innerHTML = `
            <span>Olá, <a href="telausuario.html">${usuarioLogin}</a> |</span>
            <a href="javascript:void(0);" class="hover-sair" onclick="logout()"> Sair</a>
        `;
  } else {
    // Caso não esteja logado
    userNav.innerHTML = `<a href="telalogin.html"><h3>Conta</h3></a>`;
  }
});

// === Função de logout ===
function logout() {
  // Remove dados do usuário do localStorage
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('usuarioId');
  localStorage.removeItem('usuarioNome');
  localStorage.removeItem('usuarioEmail');
  localStorage.removeItem('usuarioTelefone');

  // Limpa carrinho também, se quiser
  localStorage.removeItem('cart');
  localStorage.removeItem('cartOpen');

  // Redireciona para login
  window.location.href = 'telalogin.html';
}
