'use strict';

let carrinho = [];
let searchTimeout = null;

// Função reutilizável de Toast
function toast(msg, type = 'info', duration = 4000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), duration);
}

// 1. Busca produtos na API existente
async function buscarProduto() {
  const q = document.getElementById('searchInput').value.trim();
  const resDiv = document.getElementById('searchResults');
  
  if (q.length < 2) { resDiv.innerHTML = ''; return; }

  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      // Usa a mesma rota de pesquisa da tela de manual
      const res = await fetch(`/products/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      
      resDiv.innerHTML = data.items.map(p => `
        <div class="search-result-item" onclick='adicionarAoCarrinho(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
          <img src="${p.image || '/assets/placeholder.png'}" class="search-result-img">
          <div>
            <div style="font-weight: bold; font-size: 13px;">${p.name}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">SKU: ${p.sku} | EAN: ${p.ean || '--'}</div>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  }, 400);
}

// 2. Adiciona ao Carrinho local
function adicionarAoCarrinho(produto) {
  if (carrinho.find(item => item.sku === produto.sku)) {
    return toast('Produto já está na lista!', 'err');
  }

  carrinho.push({
    sku: produto.sku,
    name: produto.name,
    image: produto.image || '/assets/placeholder.png',
    marca: produto.marca || 'N/A',
    ean: produto.ean || 'N/A',
    qty: 1,
    modalidade: 'FULL / FLEX'
  });

  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').innerHTML = '';
  renderizarCarrinho();
  toast('Adicionado à lista', 'info');
}

function removerDoCarrinho(sku) {
  carrinho = carrinho.filter(item => item.sku !== sku);
  renderizarCarrinho();
}

function atualizarQty(sku, val) {
  const item = carrinho.find(i => i.sku === sku);
  if (item) item.qty = Number(val);
}

function atualizarModalidade(sku, val) {
  const item = carrinho.find(i => i.sku === sku);
  if (item) item.modalidade = val;
}

function renderizarCarrinho() {
  const tbody = document.getElementById('cartBody');
  if (carrinho.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Nenhum item adicionado</td></tr>`;
    return;
  }

  tbody.innerHTML = carrinho.map(item => `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="${item.image}" style="width:40px; height:40px; border-radius:6px; object-fit:cover;">
          <div>
            <div style="font-size: 13px; font-weight:bold;">${item.name}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">SKU: ${item.sku}</div>
          </div>
        </div>
      </td>
      <td style="font-size: 12px;">Marca: ${item.marca}<br>EAN: ${item.ean}</td>
      <td>
        <input type="number" min="1" value="${item.qty}" class="cart-input" onchange="atualizarQty('${item.sku}', this.value)">
      </td>
      <td>
        <select class="cart-select" onchange="atualizarModalidade('${item.sku}', this.value)">
          <option value="FULL / FLEX" ${item.modalidade === 'FULL / FLEX' ? 'selected' : ''}>FULL / FLEX</option>
          <option value="AGENCIA / FLEX" ${item.modalidade === 'AGENCIA / FLEX' ? 'selected' : ''}>AGÊNCIA / FLEX</option>
        </select>
      </td>
      <td>
        <button class="btn-remove" onclick="removerDoCarrinho('${item.sku}')">✕</button>
      </td>
    </tr>
  `).join('');
}

// 3. Fechar Lista, Salvar no Backend, Alertar Embalagens e Gerar PDF
async function fecharLista() {
  if (carrinho.length === 0) return toast('A lista está vazia!', 'err');
  
  const btn = document.getElementById('btnFechar');
  btn.disabled = true;
  btn.textContent = 'Processando...';

  try {
    // A. Salva no backend e recebe os alertas de embalagem
    const res = await fetch('/api/compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: carrinho })
    });
    const data = await res.json();

    if (!data.ok) throw new Error(data.error);

    // B. Push/Toast Alert de Embalagens Necessárias
    if (data.alertasEmbalagem && data.alertasEmbalagem.length > 0) {
      data.alertasEmbalagem.forEach((alerta, index) => {
        // Dispara toasts sequenciais se houver mais de um alerta
        setTimeout(() => toast(alerta, 'err', 8000), index * 1000); 
      });
    } else {
      toast('Lista salva com sucesso!', 'ok');
    }

    // C. Gera o PDF
    gerarPDF(data.compraId);

  } catch (err) {
    toast(`Erro: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Fechar Lista & Gerar PDF';
  }
}

// 4. Montar e Exportar o PDF
function gerarPDF(compraId) {
  document.getElementById('pdf-date').textContent = `Data: ${new Date().toLocaleDateString('pt-BR')} | ID: ${compraId}`;
  
  const pdfBody = document.getElementById('pdf-body');
  pdfBody.innerHTML = carrinho.map(item => `
    <tr>
      <td style="text-align:center;"><img src="${item.image}" class="pdf-thumb" crossorigin="anonymous"></td>
      <td><strong>${item.name}</strong><br><small>SKU: ${item.sku}</small></td>
      <td>${item.marca}</td>
      <td>${item.ean}</td>
      <td><strong>${item.modalidade}</strong></td>
      <td style="text-align:center; font-size: 16px;"><strong>${item.qty}</strong></td>
    </tr>
  `).join('');

  // Configuração do html2pdf
  const element = document.getElementById('pdf-template');
  element.style.display = 'block'; // Mostra temporariamente para o print

  const opt = {
    margin:       10,
    filename:     `Pedido_Compra_${compraId}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true }, // useCORS permite carregar fotos do Bling/Firebase no PDF
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    element.style.display = 'none'; // Esconde novamente
    carrinho = []; // Limpa o carrinho após sucesso
    renderizarCarrinho();
  });
}