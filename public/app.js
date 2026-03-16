// expedicao-pro/public/app.js
'use strict';

const API_BASE = '';
const TERMINAL_ID_KEY = 'expedicao_pro_terminal_id';

function getOrCreateTerminalId() {
  let id = localStorage.getItem(TERMINAL_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `t_${Math.random().toString(16).slice(2)}`);
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

// ---------------- Toast + beep ----------------
const toastEl = document.getElementById('toast');
let toastTimer = null;

function toast(msg, type = 'info') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close().catch(() => {});
    }, ok ? 80 : 160);
  } catch {}
}

// ---------------- State ----------------
const state = {
  pending: [],
  picked: [],
  packed: [],
  selectedOrderId: null,
  selectedOrder: null,
  scannerBuffer: ''
};

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

function sortOrders(arr) {
  arr.sort((a, b) => {
    const pA = a.isPriority ? 1 : 0;
    const pB = b.isPriority ? 1 : 0;
    if (pA !== pB) return pB - pA;
    return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
  });
}

function canConfirmPicked(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.length > 0 && items.every((it) => Number(it.checkedQty || 0) >= Number(it.qty || 0));
}

// ---------------- DOM refs ----------------
const colPending = document.getElementById('col-pending');
const colPicked = document.getElementById('col-picked');
const colPacked = document.getElementById('col-packed');

const selectedMeta = document.getElementById('selectedMeta');
const selectedItems = document.getElementById('selectedItems');

const btnPicked = document.getElementById('btnPicked');
const btnPacked = document.getElementById('btnPacked');

const scannerInput = document.getElementById('scannerInput');

// ---------------- Render ----------------
function renderColumns() {
  renderColumn(colPending, state.pending, 'pending');
  renderColumn(colPicked, state.picked, 'picked');
  renderColumn(colPacked, state.packed, 'packed');
}

function renderColumn(el, orders, status) {
  el.innerHTML = '';
  if (!orders.length) {
    el.innerHTML = `<div class="small muted">Sem pedidos.</div>`;
    return;
  }

  for (const o of orders) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className =
      'orderCard' +
      (o.id === state.selectedOrderId ? ' orderCard--active' : '') +
      (o.isPriority ? ' orderCard--priority' : '');

    const total = (o.items || []).reduce((acc, it) => acc + Number(it.qty || 0), 0);
    const checked = (o.items || []).reduce((acc, it) => acc + Number(it.checkedQty || 0), 0);

    card.innerHTML = `
      <div class="orderCard__top">
        <div class="orderId">${o.isPriority ? '🔥 ' : ''}${escapeHtml(o.id || '')}</div>
        <div class="pill">${escapeHtml(o.marketplace || '')}</div>
      </div>
      <div class="orderCard__meta small muted">
        <span>Itens: ${checked}/${total}</span>
        <span>${new Date(o.createdAtMs || 0).toLocaleString()}</span>
      </div>
    `;

    card.addEventListener('click', () => selectOrder(o.id, status));
    el.appendChild(card);
  }
}

function renderSelected() {
  selectedItems.innerHTML = '';

  if (!state.selectedOrder) {
    selectedMeta.textContent = 'Nenhum pedido selecionado.';
    btnPicked.disabled = true;
    btnPacked.disabled = true;
    return;
  }

  const o = state.selectedOrder;

  selectedMeta.innerHTML = `
    <span class="pill">ID: ${escapeHtml(o.id)}</span>
    <span class="pill">Status: ${escapeHtml(o.status)}</span>
    ${o.isPriority ? `<span class="pill pill--priority">PRIORIDADE / FLEX</span>` : ''}
  `;

  btnPicked.disabled = !(o.status === 'pending' && canConfirmPicked(o));
  btnPacked.disabled = !(o.status === 'picked');

  const items = Array.isArray(o.items) ? o.items : [];
  for (const it of items) {
    const qty = Number(it.qty || 0);
    const checked = Number(it.checkedQty || 0);

    const imageSrc =
      (Array.isArray(it.images) && it.images.length ? it.images[0] : null) ||
      it.image ||
      './assets/placeholder.png';

    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="item__img">
        <img alt="" src="${imageSrc}" onerror="this.src='./assets/placeholder.png'">
      </div>
      <div class="item__main">
        <div class="item__title">${escapeHtml(it.nameShort || '')}</div>
        <div class="item__meta">
          <span class="pill">SKU: ${escapeHtml(it.sku || '')}</span>
          <span class="pill">EAN: ${escapeHtml(it.ean || '')}</span>
          <span class="pill">BIN: ${escapeHtml(it.bin || '')}</span>
        </div>
      </div>
      <div class="item__actions">
        <div class="qtyView ${checked >= qty ? 'qtyView--ok' : ''}">${checked} / ${qty}</div>
      </div>
    `;
    selectedItems.appendChild(row);
  }
}

// ---------------- Actions ----------------
async function selectOrder(orderId, status) {
  state.selectedOrderId = orderId;

  const bucket = status === 'pending' ? state.pending : status === 'picked' ? state.picked : state.packed;
  state.selectedOrder = bucket.find((x) => x.id === orderId) || null;

  renderColumns();
  renderSelected();

  // foco para scanner
  scannerInput?.focus?.();

  // tenta lock automático
  try {
    await api(`/orders/${encodeURIComponent(orderId)}/lock`, { method: 'POST', body: JSON.stringify({}) });
  } catch {}
}

async function refreshAll() {
  try {
    const [pending, picked, packed] = await Promise.all([
      api('/orders/list?status=pending&limit=40'),
      api('/orders/list?status=picked&limit=40'),
      api('/orders/list?status=packed&limit=40')
    ]);

    state.pending = pending.items || [];
    state.picked = picked.items || [];
    state.packed = packed.items || [];

    sortOrders(state.pending);
    sortOrders(state.picked);
    sortOrders(state.packed);

    renderColumns();

    if (state.selectedOrderId) {
      const found =
        state.pending.find((x) => x.id === state.selectedOrderId) ||
        state.picked.find((x) => x.id === state.selectedOrderId) ||
        state.packed.find((x) => x.id === state.selectedOrderId);

      state.selectedOrder = found || null;
      renderSelected();
    }
  } catch (e) {
    toast(`Erro ao atualizar: ${e.message}`, 'error');
  }
}

async function takeLock() {
  if (!state.selectedOrderId) return toast('Selecione um pedido primeiro.', 'info');
  try {
    const r = await api(`/orders/${encodeURIComponent(state.selectedOrderId)}/lock`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (r.ok) toast('Lock atualizado ✅', 'success');
    else toast('Pedido está lockado por outro terminal.', 'error');
  } catch (e) {
    toast(`Erro lock: ${e.message}`, 'error');
  }
}

async function markPicked() {
  if (!state.selectedOrderId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(state.selectedOrderId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'picked' })
    });
    if (r.ok) {
      toast('Pedido marcado como SEPARADO ✅', 'success');
      await refreshAll();
    } else toast(`Falha: ${r.error}`, 'error');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  }
}

async function markPacked() {
  if (!state.selectedOrderId) return;
  try {
    const r = await api(`/orders/${encodeURIComponent(state.selectedOrderId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'packed' })
    });
    if (r.ok) {
      toast('Pedido marcado como EXPEDIDO ✅', 'success');
      await refreshAll();
    } else toast(`Falha: ${r.error}`, 'error');
  } catch (e) {
    toast(`Erro: ${e.message}`, 'error');
  }
}

// ---------------- Scanner ----------------
function handleKeydown(e) {
  if (e.key === 'Enter') {
    const code = state.scannerBuffer.trim();
    state.scannerBuffer = '';
    if (code) onScan(code);
    return;
  }
  if (e.key.length === 1) state.scannerBuffer += e.key;
}

async function onScan(code) {
  if (!state.selectedOrderId) return toast('Selecione um pedido antes de bipar.', 'info');

  try {
    const r = await api(`/orders/${encodeURIComponent(state.selectedOrderId)}/check`, {
      method: 'POST',
      body: JSON.stringify({ code })
    });

    if (r.ok) {
      beep(true);
      toast(`OK: ${r.sku} (${r.checkedQty}/${r.qty})`, 'success');
      await refreshAll();
    } else {
      beep(false);
      toast(`Falha: ${r.error}`, 'error');
    }
  } catch (e) {
    beep(false);
    toast(`Erro: ${e.message}`, 'error');
  }
}

// Expor funções usadas no HTML
window.refreshAll = refreshAll;
window.takeLock = takeLock;

// Bind botões
btnPicked.addEventListener('click', markPicked);
btnPacked.addEventListener('click', markPacked);

// scanner: captura teclado global
window.addEventListener('keydown', handleKeydown);

// inicia
refreshAll();
setInterval(refreshAll, 8000);