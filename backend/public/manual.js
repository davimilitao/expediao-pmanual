// expedicao-pro/public/manual.js

// --------- config ----------
const API_BASE = ''; // mesmo host (servido pelo backend)
const TERMINAL_ID_KEY = 'expedicao_pro_terminal_id';

// ✅ Busca “typeahead” a partir de 3 letras
const MIN_SEARCH_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 220;

function getOrCreateTerminalId() {
  let id = localStorage.getItem(TERMINAL_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(TERMINAL_ID_KEY, id);
  }
  return id;
}

const terminalId = getOrCreateTerminalId();

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-terminal-id': terminalId,
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --------- utils de imagem ----------
function getImgUrl(url) {
  // Se não tiver nada, retorna o placeholder da raiz (sem /uploads/)
  if (!url) return '/assets/placeholder.png';
  
  // Se for Cloudinary (começa com http), retorna a URL pura
  if (url.startsWith('http')) return url;
  
  // Se for arquivo local antigo, aí sim coloca o prefixo
  return `/uploads/${url}`;
}

// --------- toast ----------
const toastEl = document.getElementById('toast');
let toastTimer = null;

function toast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
}

// --------- state ----------
const state = {
  results: [],
  cart: new Map(), // sku -> { sku, name, ean, bin, qty }
  lastQuery: '',
  searching: false,
  debounceTimer: null,
  activeSearchId: 0
};

function renderResults() {
  const box = document.getElementById('searchResults');
  const info = document.getElementById('searchInfo');
  box.innerHTML = '';

  const q = document.getElementById('q').value.trim();

  if (q.length < MIN_SEARCH_CHARS) {
    info.textContent = `Digite ao menos ${MIN_SEARCH_CHARS} letras para buscar (ou informe SKU/EAN).`;
    return;
  }

  if (state.searching) {
    info.textContent = 'Buscando...';
    return;
  }

  if (state.results.length === 0) {
    info.textContent = 'Sem resultados.';
    return;
  }

  info.textContent = `${state.results.length} resultado(s).`;

  for (const p of state.results) {
    // ✅ Nome vem exatamente do CSV (campo p.name)
    const row = document.createElement('div');
    row.className = 'item';

    row.innerHTML = `
      <div class="item__img"><img alt="" src="${getImgUrl(p.image)}"></div>
      <div class="item__main">
        <div class="item__title">${escapeHtml(p.name || '')}</div>
        <div class="item__meta">
          <span class="pill">SKU: ${escapeHtml(p.sku || '')}</span>
          <span class="pill">EAN: ${escapeHtml(p.ean || '')}</span>
          <span class="pill">BIN: ${escapeHtml(p.bin || '')}</span>
        </div>
      </div>
      <div class="item__actions">
        <input class="qty" type="number" min="1" value="1" />
        <button class="btn btn--small">Adicionar</button>
      </div>
    `;

    const qtyInput = row.querySelector('.qty');
    const btn = row.querySelector('button');
    btn.addEventListener('click', () => {
      const qty = Number(qtyInput.value || 1);
      addToCart(p, qty);
      pushRecentProduct(p);
      focusSearchInput(true);
    });

    box.appendChild(row);
  }
}

function renderCart() {
  const empty = document.getElementById('cartEmpty');
  const list = document.getElementById('cartList');

  list.innerHTML = '';
  const arr = Array.from(state.cart.values());

  if (arr.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  for (const it of arr) {
    const row = document.createElement('div');
    row.className = 'item';

    row.innerHTML = `
      <div class="item__img"><img alt="" src="${getImgUrl(it.image)}"></div>
      <div class="item__main">
        <div class="item__title">${escapeHtml(it.name || '')}</div>
        <div class="item__meta">
          <span class="pill">SKU: ${escapeHtml(it.sku || '')}</span>
          <span class="pill">EAN: ${escapeHtml(it.ean || '')}</span>
          <span class="pill">BIN: ${escapeHtml(it.bin || '')}</span>
        </div>
      </div>
      <div class="item__actions">
        <input class="qty" type="number" min="1" value="${it.qty}" />
        <button class="btn btn--small btn--danger">Remover</button>
      </div>
    `;

    const qtyInput = row.querySelector('.qty');
    qtyInput.addEventListener('change', () => {
      const qty = Number(qtyInput.value || 1);
      if (qty <= 0) return;
      state.cart.set(it.sku, { ...it, qty });
    });

    const btn = row.querySelector('button');
    btn.addEventListener('click', () => {
      state.cart.delete(it.sku);
      renderCart();
    });

    list.appendChild(row);
  }
}

function addToCart(p, qty) {
  const sku = p.sku;
  if (!sku) return;

  const prev = state.cart.get(sku);
  const nextQty = (prev ? prev.qty : 0) + (Number.isFinite(qty) ? qty : 1);

  state.cart.set(sku, {
    sku: p.sku,
    name: p.name || '',
    image: p.image || '', // <-- ADICIONE ESTA LINHA
    ean: p.ean || '',
    bin: p.bin || '',
    qty: nextQty
  });

  toast(`Adicionado: ${p.sku} (x${qty})`, 'success');
  renderCart();
}

// --------- search (typeahead) ----------
async function doSearchNow() {
  const qEl = document.getElementById('q');
  const q = qEl.value.trim();

  // ✅ regra: só busca se tiver >= 3 chars, EXCETO se for SKU/EAN (sem espaço) com 1+ char
  const looksLikeCode = q.length > 0 && !q.includes(' ');
  const shouldSearch = q.length >= MIN_SEARCH_CHARS || looksLikeCode;

  if (!shouldSearch) {
    state.results = [];
    state.searching = false;
    renderResults();
    return;
  }

  // evita repetir mesma query
  if (q === state.lastQuery) return;

  state.lastQuery = q;
  state.searching = true;
  renderResults();

  // controle de “race condition” (se digitar rápido, ignora resposta velha)
  const searchId = ++state.activeSearchId;

  try {
    const data = await api(`/products/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
    if (searchId !== state.activeSearchId) return;

    state.results = data.items || [];
  } catch (e) {
    if (searchId !== state.activeSearchId) return;

    state.results = [];
    toast(`Erro na busca: ${e.message}`, 'error');
  } finally {
    if (searchId !== state.activeSearchId) return;

    state.searching = false;
    renderResults();
  }
}

function scheduleSearch() {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(doSearchNow, SEARCH_DEBOUNCE_MS);
}

// --------- create order ----------
async function doCreateOrder() {
  const marketplace = document.getElementById('marketplace').value;
  const clienteNome = document.getElementById('clienteNome').value.trim();

  const cart = Array.from(state.cart.values()).map((it) => ({ sku: it.sku, qty: it.qty }));
  if (cart.length === 0) return toast('Carrinho vazio.', 'error');

  const info = document.getElementById('createInfo');
  info.textContent = 'Criando pedido...';

  const isPriority = document.getElementById('isPriorityToggle').checked;

  try {
    const data = await api('/orders/manual', {
      method: 'POST',
      body: JSON.stringify({ marketplace, clienteNome, isPriority, cart })
    });

    toast(`Pedido criado: ${data.orderId}`, 'success');
    info.innerHTML = `✅ Pedido criado: <strong>${escapeHtml(data.orderId)}</strong> — <a class="link" href="./">abrir painel</a>`;

    state.cart.clear();
    renderCart();
  } catch (e) {
    toast(`Erro ao criar pedido: ${e.message}`, 'error');
    info.textContent = `Erro: ${e.message}`;
  }
}

// --------- utils ----------
function escapeHtml(str) {
  return (str ?? '').toString().replace(/[&<>"']/g, (m) => {
    return (
      {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m] || m
    );
  });
}

// --------- bind ----------


// --------- UX helpers ----------
function focusSearchInput(selectAll = false) {
  const qEl = document.getElementById('q');
  if (!qEl) return;
  qEl.focus();
  if (selectAll) qEl.select();
}

function canQuickAddFirstResult() {
  const q = document.getElementById('q')?.value?.trim() || '';
  return state.results.length > 0 && !state.searching && q && q === state.lastQuery;
}

// --------- recent searched products ----------
const RECENT_KEY = 'expedicao_recent_products_v1';
const recentEl = document.getElementById('recentChips');

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function saveRecent(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)));
}

function pushRecentProduct(p) {
  if (!p?.sku) return;
  const list = loadRecent().filter(x => x.sku !== p.sku);
  list.unshift({ sku: p.sku, name: p.name || '', ean: p.ean || '' });
  saveRecent(list);
  renderRecent();
}

function renderRecent() {
  if (!recentEl) return;
  const list = loadRecent();
  recentEl.innerHTML = '';

  if (list.length === 0) {
    recentEl.innerHTML = '<div class="muted small">Nenhuma busca recente ainda.</div>';
    return;
  }

  for (const p of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.innerHTML = `<span class="chip__name">${escapeHtml(p.name || 'Produto')}</span><span class="chip__meta">${escapeHtml(p.sku || '')}</span>`;
    btn.addEventListener('click', async () => {
      const found = state.results.find(r => r.sku === p.sku);
      if (found) {
        addToCart(found, 1);
        focusSearchInput(true);
        return;
      }
      try {
        document.getElementById('q').value = p.sku;
        clearTimeout(state.debounceTimer);
        await doSearchNow();
        const again = state.results.find(r => r.sku === p.sku) || state.results[0];
        if (again) {
          addToCart(again, 1);
          focusSearchInput(true);
        }
      } catch (e) {
        toast(`Não consegui adicionar o recente: ${e.message}`, 'error');
      }
    });
    recentEl.appendChild(btn);
  }
}

// --------- priority toggle UI (FLEX) ----------
const prioBtn = document.getElementById('isPriorityToggleBtn');
const prioCheckbox = document.getElementById('isPriorityToggle');
const prioBadge = document.getElementById('priorityBadge');

function renderPriorityUI() {
  if (!prioBtn || !prioCheckbox || !prioBadge) return;
  const on = !!prioCheckbox.checked;
  prioBtn.classList.toggle('is-on', on);
  prioBtn.setAttribute('aria-pressed', String(on));
  prioBadge.style.display = on ? 'inline-flex' : 'none';
}

if (prioBtn && prioCheckbox) {
  prioBtn.addEventListener('click', () => {
    prioCheckbox.checked = !prioCheckbox.checked;
    renderPriorityUI();
  });
}

// --------- marketplace buttons ----------
const marketplaceHidden = document.getElementById('marketplace');
const mktBtns = document.querySelectorAll('.mktBtn');

function renderMkt() {
  if (!marketplaceHidden) return;
  const val = marketplaceHidden.value || 'MERCADO_LIVRE';
  mktBtns.forEach(b => b.classList.toggle('is-active', b.dataset.value === val));
}

mktBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!marketplaceHidden) return;
    marketplaceHidden.value = btn.dataset.value;
    renderMkt();
  });
});

document.getElementById('q').addEventListener('input', () => {
  // ✅ a partir de 3 letras vai aparecendo (debounced)
  scheduleSearch();
});

document.getElementById('q').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  // Se já existe resultado atual, Enter adiciona o 1º item (mais rápido no bip)
  if (canQuickAddFirstResult()) {
    const first = state.results[0];
    addToCart(first, 1);
    pushRecentProduct(first);
    focusSearchInput(true);
    return;
  }

  // Senão, força busca imediata
  clearTimeout(state.debounceTimer);
  await doSearchNow();

  // Se após buscar veio resultado, um 2º Enter já adiciona (fluxo natural)
});

document.getElementById('btnSearch').addEventListener('click', () => {
  clearTimeout(state.debounceTimer);
  doSearchNow();
});

document.getElementById('btnClear').addEventListener('click', () => {
  state.cart.clear();
  renderCart();
  toast('Carrinho limpo.', 'info');
});

document.getElementById('btnCreate').addEventListener('click', doCreateOrder);

// init
renderCart();
renderResults();
renderRecent();
renderPriorityUI();
renderMkt();
focusSearchInput(false);
